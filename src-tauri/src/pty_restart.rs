//! Fail-closed terminal restart proof. A process name/foreground title cannot
//! distinguish a prompt from a builtin, nor account for background jobs.

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const UNKNOWN: &str = "Could not verify an idle terminal prompt. Return to an empty zsh prompt or close that terminal, then retry the update.";
const BUSY: &str = "Terminal work or input is still active. Finish foreground, background and stopped jobs and clear the prompt before retrying the update.";

pub(super) struct PromptChannel {
    stream: Mutex<UnixStream>,
    startup_dir: PathBuf,
}

impl Drop for PromptChannel {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(self.startup_dir.join(".zshenv"));
        let _ = std::fs::remove_dir(&self.startup_dir);
    }
}

/// A successful proof parks the shell, preventing queued input from starting
/// work between the final owner check and install. Drop resumes on cancellation.
pub(crate) struct PromptLease {
    channel: Arc<PromptChannel>,
    id: String,
}

impl Drop for PromptLease {
    fn drop(&mut self) {
        if let Ok(mut stream) = self.channel.stream.lock() {
            if writeln!(stream, "resume:{}", self.id).is_err() {
                let _ = stream.shutdown(std::net::Shutdown::Both);
            }
        }
    }
}

pub(super) fn configure(
    command: &mut Command,
    shell: &str,
) -> Result<Option<(Arc<PromptChannel>, UnixStream)>, String> {
    if std::path::Path::new(shell)
        .file_name()
        .and_then(|n| n.to_str())
        != Some("zsh")
    {
        return Ok(None);
    }
    use std::os::unix::fs::DirBuilderExt;
    let directory = std::env::temp_dir().join(format!("monocode-prompt-{}", uuid::Uuid::new_v4()));
    let (parent, child) = UnixStream::pair().map_err(|e| e.to_string())?;
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&directory)
        .map_err(|e| e.to_string())?;
    let channel = Arc::new(PromptChannel {
        stream: Mutex::new(parent),
        startup_dir: directory,
    });
    std::fs::write(
        channel.startup_dir.join(".zshenv"),
        include_str!("pty_restart.zsh"),
    )
    .map_err(|e| e.to_string())?;
    // Respect command-local overrides too (the isolated harness supplies HOME).
    let original = command
        .get_envs()
        .find(|(key, _)| *key == "ZDOTDIR")
        .map(|(_, value)| value.map(|v| v.to_os_string()))
        .unwrap_or_else(|| std::env::var_os("ZDOTDIR"));
    command.env(
        "MONOCODE_ORIGINAL_ZDOTDIR_SET",
        if original.is_some() { "1" } else { "0" },
    );
    command.env("MONOCODE_ORIGINAL_ZDOTDIR", original.unwrap_or_default());
    command.env("ZDOTDIR", &channel.startup_dir);
    Ok(Some((channel, child)))
}

pub(super) unsafe fn inherit_socket(fd: i32) -> std::io::Result<()> {
    if libc::dup2(fd, 9) < 0 || libc::fcntl(9, libc::F_SETFD, 0) < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

pub(super) fn park(channel: Option<&Arc<PromptChannel>>) -> Result<PromptLease, String> {
    let channel = channel.ok_or(UNKNOWN)?.clone();
    let lease = PromptLease {
        channel: channel.clone(),
        id: uuid::Uuid::new_v4().simple().to_string(),
    };
    let result = (|| {
        let mut stream = channel.stream.lock().map_err(|_| UNKNOWN)?;
        stream
            .set_write_timeout(Some(Duration::from_millis(500)))
            .map_err(|_| UNKNOWN)?;
        writeln!(stream, "check:{}", lease.id).map_err(|_| UNKNOWN)?;
        let deadline = Instant::now() + Duration::from_millis(500);
        loop {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or(UNKNOWN)?;
            stream
                .set_read_timeout(Some(remaining))
                .map_err(|_| UNKNOWN)?;
            let mut line = Vec::new();
            loop {
                let mut byte = [0];
                stream.read_exact(&mut byte).map_err(|_| UNKNOWN)?;
                if byte[0] == b'\n' {
                    break;
                }
                if line.len() >= 128 {
                    return Err(UNKNOWN);
                }
                line.push(byte[0]);
            }
            if line == format!("ready:{}", lease.id).as_bytes() {
                return Ok(());
            }
            if line == format!("busy:{}", lease.id).as_bytes() {
                return Err(BUSY);
            }
            // Ignore a late response to a timed-out request. That request's
            // Drop already queued its matching resume, so it cannot trap ZLE.
        }
    })();
    result.map_err(str::to_string)?;
    Ok(lease)
}

#[derive(Debug)]
struct Process {
    pid: i32,
    parent: i32,
    group: i32,
    foreground: i32,
    tty: String,
    state: String,
}

fn parse_processes(bytes: &[u8]) -> Result<Vec<Process>, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| UNKNOWN)?;
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let parts: Vec<_> = line.split_whitespace().collect();
            if parts.len() != 6 {
                return Err(UNKNOWN.to_string());
            }
            let number = |i: usize| parts[i].parse::<i32>().map_err(|_| UNKNOWN.to_string());
            Ok(Process {
                pid: number(0)?,
                parent: number(1)?,
                group: number(2)?,
                foreground: number(3)?,
                tty: parts[4].into(),
                state: parts[5].into(),
            })
        })
        .collect()
}

fn inspect(processes: &[Process], pid: i32, foreground: i32) -> Result<(), String> {
    let root = processes.iter().find(|p| p.pid == pid).ok_or(UNKNOWN)?;
    if root.tty == "??" || root.tty == "?" || root.group != pid || foreground <= 0 {
        return Err(UNKNOWN.into());
    }
    if foreground != pid || root.foreground != pid || root.state.starts_with(['T', 'Z', 'X']) {
        return Err(BUSY.into());
    }
    // The controlling tty catches disowned/reparented jobs as well as direct
    // children, including background and stopped process groups. A direct
    // child is blocked even if it detached from the tty/session.
    if processes
        .iter()
        .any(|p| p.pid != pid && (p.tty == root.tty || p.parent == pid || p.group == pid))
    {
        return Err(BUSY.into());
    }
    Ok(())
}

pub(super) fn inspect_terminal(master_fd: i32, pid: u32) -> Result<(), String> {
    let mut foreground: libc::pid_t = 0;
    if unsafe { libc::ioctl(master_fd, libc::TIOCGPGRP, &mut foreground) } != 0 {
        return Err(UNKNOWN.into());
    }
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,pgid=,tpgid=,tty=,stat="])
        .env("LC_ALL", "C")
        .output()
        .map_err(|_| UNKNOWN)?;
    if !output.status.success() {
        return Err(UNKNOWN.into());
    }
    inspect(&parse_processes(&output.stdout)?, pid as i32, foreground)?;
    inspect_pending_input(master_fd)
}

fn inspect_pending_input(master_fd: i32) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
        let mut name = [0 as libc::c_char; 128];
        #[cfg(target_os = "macos")]
        let result = unsafe { libc::ioctl(master_fd, libc::TIOCPTYGNAME as _, name.as_mut_ptr()) };
        #[cfg(target_os = "linux")]
        let result = unsafe { libc::ptsname_r(master_fd, name.as_mut_ptr(), name.len()) };
        if result != 0 || name[name.len() - 1] != 0 {
            return Err(UNKNOWN.into());
        }
        let raw = unsafe {
            libc::open(
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOCTTY | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        if raw < 0 {
            return Err(UNKNOWN.into());
        }
        let slave = unsafe { OwnedFd::from_raw_fd(raw) };
        let mut pending: libc::c_int = 0;
        if unsafe { libc::ioctl(slave.as_raw_fd(), libc::FIONREAD, &mut pending) } != 0
            || pending < 0
        {
            return Err(UNKNOWN.into());
        }
        if pending != 0 {
            return Err(BUSY.into());
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = master_fd;
        Err(UNKNOWN.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::process::CommandExt;
    use std::process::{Child, Stdio};

    struct Shell {
        child: Child,
        master: File,
        channel: Arc<PromptChannel>,
        home: PathBuf,
        output: String,
    }

    impl Shell {
        fn new() -> Self {
            let home =
                std::env::temp_dir().join(format!("monocode-prompt-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&home).unwrap();
            // Only fixture-owned startup files; never load the owner's profile.
            std::fs::write(home.join(".zshenv"), "export MC_ENV_SEEN=yes\n").unwrap();
            std::fs::write(
                home.join(".zshrc"),
                "PS1='MC_PROMPT> '; RPS1=''; PROMPT_EOL_MARK=''; HISTFILE=/dev/null\n",
            )
            .unwrap();
            let mut master = -1;
            let mut slave = -1;
            assert_eq!(
                unsafe {
                    libc::openpty(
                        &mut master,
                        &mut slave,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                    )
                },
                0
            );
            let master = unsafe { File::from_raw_fd(master) };
            let slave = unsafe { File::from_raw_fd(slave) };
            let mut command = Command::new("/bin/zsh");
            command
                .arg("-l")
                .env_clear()
                .env("HOME", &home)
                .env("PATH", "/usr/bin:/bin")
                .env("TERM", "xterm-256color")
                .env_remove("ZDOTDIR");
            command
                .stdin(Stdio::from(slave.try_clone().unwrap()))
                .stdout(Stdio::from(slave.try_clone().unwrap()))
                .stderr(Stdio::from(slave.try_clone().unwrap()));
            let (channel, socket) = configure(&mut command, "/bin/zsh").unwrap().unwrap();
            let fd = socket.as_raw_fd();
            unsafe {
                command.pre_exec(move || {
                    if libc::setsid() < 0 || libc::ioctl(0, libc::TIOCSCTTY as _, 0) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    inherit_socket(fd)
                });
            }
            let child = command.spawn().unwrap();
            drop(slave);
            drop(socket);
            let mut shell = Self {
                child,
                master,
                channel,
                home,
                output: String::new(),
            };
            shell.until("MC_PROMPT> ");
            shell
        }

        fn send(&mut self, text: &str) {
            self.output.clear();
            self.master.write_all(text.as_bytes()).unwrap();
        }

        fn pump(&mut self, milliseconds: i32) {
            let mut fd = libc::pollfd {
                fd: self.master.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            if unsafe { libc::poll(&mut fd, 1, milliseconds) } > 0 {
                let mut bytes = [0; 4096];
                if let Ok(size) = self.master.read(&mut bytes) {
                    self.output
                        .push_str(&String::from_utf8_lossy(&bytes[..size]));
                }
            }
        }

        fn until(&mut self, text: &str) {
            let deadline = Instant::now() + Duration::from_secs(5);
            while !self.output.contains(text) && Instant::now() < deadline {
                self.pump(20);
            }
            assert!(
                self.output.contains(text),
                "Missing {text:?}: {:?}",
                self.output
            );
        }

        fn inspect(&self) -> Result<(), String> {
            inspect_terminal(self.master.as_raw_fd(), self.child.id())
        }

        fn lease(&self) -> Result<PromptLease, String> {
            self.inspect()?;
            let lease = park(Some(&self.channel))?;
            self.inspect()?;
            Ok(lease)
        }
    }

    impl Drop for Shell {
        fn drop(&mut self) {
            // Only this test's fresh, isolated PTY/process group is cleaned up.
            if self.child.try_wait().ok().flatten().is_none() {
                unsafe {
                    libc::kill(-(self.child.id() as i32), libc::SIGHUP);
                }
                let deadline = Instant::now() + Duration::from_millis(500);
                while self.child.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
                    self.pump(10);
                }
                if self.child.try_wait().ok().flatten().is_none() {
                    let _ = self.child.kill();
                }
                let _ = self.child.wait();
            }
            let _ = std::fs::remove_dir_all(&self.home);
        }
    }

    #[test]
    fn snapshot_rejects_foreground_background_stopped_nested_and_unknown() {
        let idle = "100 1 100 100 ttys9 S+\n";
        assert!(inspect(&parse_processes(idle.as_bytes()).unwrap(), 100, 100).is_ok());
        for child in [
            "101 100 101 101 ttys9 S",
            "101 100 101 100 ttys9 S",
            "101 100 101 100 ttys9 T",
            "101 100 100 100 ttys9 S",
            "101 1 101 100 ttys9 S",
            "101 100 101 -1 ?? S",
        ] {
            assert!(inspect(
                &parse_processes(format!("{idle}{child}\n").as_bytes()).unwrap(),
                100,
                100
            )
            .is_err());
        }
        assert!(parse_processes(b"unreadable").is_err());
        assert!(inspect(&[], 100, 100).is_err());
        assert!(inspect_terminal(-1, 100).is_err());
        assert!(park(None).is_err());
    }

    #[test]
    fn real_idle_prompt_is_parked_and_resumes_without_losing_input() {
        let mut shell = Shell::new();
        shell.send("print $MC_ENV_SEEN\n");
        shell.until("MC_PROMPT> ");
        assert!(shell.output.contains("yes"));
        let lease = shell.lease().unwrap();
        shell.send("print $((21+21))\n");
        shell.pump(100);
        assert!(!shell.output.contains("42"));
        assert!(shell.inspect().is_err()); // Kernel input queue is not idle.
        drop(lease);
        shell.until("MC_PROMPT> ");
        assert!(shell.output.contains("42"));
        drop(shell.lease().unwrap());
    }

    #[test]
    fn real_foreground_and_background_jobs_block() {
        let mut shell = Shell::new();
        shell.send("sleep 1\n");
        std::thread::sleep(Duration::from_millis(80));
        assert!(shell.lease().is_err());
        shell.until("MC_PROMPT> ");
        shell.send("sleep 1 &\n");
        shell.until("MC_PROMPT> ");
        assert!(shell.lease().is_err());
        shell.send("wait\n");
        shell.until("MC_PROMPT> ");
        drop(shell.lease().unwrap());
    }

    #[test]
    fn real_builtin_read_timeout_and_late_probe_do_not_trap_prompt() {
        let mut shell = Shell::new();
        shell.send("read answer\n");
        std::thread::sleep(Duration::from_millis(80));
        assert!(shell.inspect().is_ok()); // No child: a title/ps-only check is unsafe.
        assert!(shell.lease().is_err());
        shell.send("answer\n");
        shell.until("MC_PROMPT> ");
        drop(shell.lease().unwrap());
    }

    #[test]
    fn real_vared_is_not_a_primary_prompt_and_channel_failure_is_closed() {
        let mut shell = Shell::new();
        shell.send("fixture_text=''; vared fixture_text\n");
        std::thread::sleep(Duration::from_millis(80));
        assert!(shell.lease().is_err());
        shell.send("finished\n");
        shell.until("MC_PROMPT> ");
        drop(shell.lease().unwrap());
        shell.send("exec 9>&-\n");
        shell.until("MC_PROMPT> ");
        assert!(shell.lease().is_err());
    }

    #[test]
    fn rejection_in_another_terminal_releases_an_already_parked_prompt() {
        let mut first = Shell::new();
        let mut second = Shell::new();
        let leases = vec![first.lease().unwrap()];
        second.send("read answer\n");
        std::thread::sleep(Duration::from_millis(80));
        assert!(second.lease().is_err());
        drop(leases);
        first.send("print $((10+11))\n");
        first.until("MC_PROMPT> ");
        assert!(first.output.contains("21"));
        second.send("answer\n");
        second.until("MC_PROMPT> ");
    }

    #[test]
    fn real_stopped_job_and_nested_shell_block() {
        let mut shell = Shell::new();
        shell.send("sleep 20 &; fixture_job=$!; kill -STOP $fixture_job\n");
        shell.until("MC_PROMPT> ");
        assert!(shell.lease().is_err());
        shell.send("kill -CONT $fixture_job; kill $fixture_job; wait $fixture_job\n");
        shell.until("MC_PROMPT> ");
        shell.send("zsh -f\n");
        std::thread::sleep(Duration::from_millis(80));
        assert!(shell.lease().is_err());
        shell.send("exit\n");
        shell.until("MC_PROMPT> ");
        drop(shell.lease().unwrap());
    }

    #[test]
    fn real_prompt_draft_and_continuation_are_not_discarded() {
        let mut shell = Shell::new();
        shell.send("unfinished");
        std::thread::sleep(Duration::from_millis(80));
        assert!(shell.lease().is_err());
        shell.send("\x15\n");
        shell.until("MC_PROMPT> ");
        shell.send("echo '\n");
        std::thread::sleep(Duration::from_millis(80));
        assert!(shell.lease().is_err());
        shell.send("'\n");
        shell.until("MC_PROMPT> ");
        drop(shell.lease().unwrap());
    }

    #[test]
    fn real_exited_shell_is_not_mistaken_for_idle_inspection() {
        let mut shell = Shell::new();
        shell.send("exit\n");
        let deadline = Instant::now() + Duration::from_secs(5);
        while shell.child.try_wait().unwrap().is_none() {
            shell.pump(20);
            assert!(
                Instant::now() < deadline,
                "Exit stalled: {:?}",
                shell.output
            );
        }
        assert!(shell.inspect().is_err()); // Host wait thread removes this entry.
    }
}
