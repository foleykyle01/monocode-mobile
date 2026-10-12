use anyhow::{ensure, Context, Result};
use rand::RngCore;
use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

pub fn random_hex() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn private_read<T: DeserializeOwned>(path: &Path) -> Result<T> {
    let metadata = fs::symlink_metadata(path).context("Private state is unavailable")?;
    ensure!(
        metadata.is_file() && metadata.len() <= 1024 * 1024,
        "Invalid state file"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        ensure!(
            metadata.permissions().mode() & 0o077 == 0,
            "State file must be private (0600)"
        );
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

pub fn private_write<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    private_write_bytes(path, &serde_json::to_vec_pretty(value)?)
}

pub fn private_write_bytes(path: &Path, value: &[u8]) -> Result<()> {
    let parent = path.parent().context("Missing state directory")?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".companion-{}.tmp", random_hex()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| -> Result<()> {
        let mut file = options.open(&temporary)?;
        file.write_all(value)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
