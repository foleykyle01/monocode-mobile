use anyhow::{Context, Result};
use monocode_companion_core::{host::Host, storage::private_write_bytes};
use std::{path::PathBuf, sync::Arc};
use tokio::io::{AsyncBufReadExt, BufReader};

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--help") {
        println!("MonoCode companion host (development)\nOptions: --local-only, --state-dir PATH, --descriptor PATH\nConsole commands: invite, devices, revoke DEVICE_ID, quit\nInvitation and QR are saved privately to the state directory, never logged.");
        return Ok(());
    }
    let home = std::env::var("HOME").context("HOME unavailable")?;
    let app_data =
        PathBuf::from(home).join("Library/Application Support/com.monocode.companion-spike");
    let mut directory = app_data.join("network");
    let mut descriptor = app_data.join("companion-spike.json");
    let mut local_only = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--local-only" => local_only = true,
            "--state-dir" | "--descriptor" => {
                let value = args.get(index + 1).context("Missing option value")?;
                if args[index] == "--state-dir" {
                    directory = value.into();
                } else {
                    descriptor = value.into();
                }
                index += 1;
            }
            other => anyhow::bail!("Unknown argument: {other}"),
        }
        index += 1;
    }
    let host = Arc::new(Host::bind(directory.join("host.json"), descriptor, local_only).await?);
    if !local_only {
        tokio::time::timeout(std::time::Duration::from_secs(20), host.endpoint.online())
            .await
            .context("Relay connection timed out")?;
    }
    println!(
        "Host ready: {}\nCommands: invite, devices, revoke DEVICE_ID, quit",
        host.endpoint.id()
    );
    let serving = host.clone();
    let task = tokio::spawn(async move { serving.serve().await });
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    loop {
        let line = tokio::select! {
            _ = tokio::signal::ctrl_c() => break,
            line = lines.next_line() => match line? { Some(line) => line, None => break },
        };
        let result: Result<()> = async {
            match line.trim() {
                "invite" => {
                    let ticket = host
                        .gate
                        .lock()
                        .await
                        .invite(host.endpoint.addr())
                        .encode()?;
                    private_write_bytes(&directory.join("pairing.txt"), ticket.as_bytes())?;
                    let code = qrcode::QrCode::new(ticket.as_bytes())?;
                    let svg = code
                        .render::<qrcode::render::svg::Color>()
                        .min_dimensions(480, 480)
                        .build();
                    private_write_bytes(&directory.join("pairing.svg"), svg.as_bytes())?;
                    let width = (code.width() + 8) * 8;
                    let mut pixels = vec![255u8; width * width];
                    for y in 0..code.width() {
                        for x in 0..code.width() {
                            if code[(x, y)] == qrcode::Color::Dark {
                                for dy in 0..8 {
                                    let start = ((y + 4) * 8 + dy) * width + (x + 4) * 8;
                                    pixels[start..start + 8].fill(0);
                                }
                            }
                        }
                    }
                    let mut bytes = Vec::new();
                    {
                        let mut encoder = png::Encoder::new(&mut bytes, width as u32, width as u32);
                        encoder.set_color(png::ColorType::Grayscale);
                        let mut writer = encoder.write_header()?;
                        writer.write_image_data(&pixels)?;
                    }
                    private_write_bytes(&directory.join("pairing.png"), &bytes)?;
                    println!(
                        "Invitation ready for 5 minutes: {} (private; do not share publicly)",
                        directory.join("pairing.svg").display()
                    );
                }
                "devices" => {
                    for peer in &host.gate.lock().await.state.devices {
                        println!("Paired device: {peer}");
                    }
                }
                "quit" => return Ok(()),
                command if command.starts_with("revoke ") => {
                    host.gate
                        .lock()
                        .await
                        .revoke(command.trim_start_matches("revoke ").trim())?;
                    println!("Device revoked");
                }
                "" => {}
                _ => println!("Commands: invite, devices, revoke DEVICE_ID, quit"),
            }
            Ok(())
        }
        .await;
        if let Err(error) = result {
            eprintln!("{error}");
        }
        if line.trim() == "quit" {
            break;
        }
    }
    host.endpoint.close().await;
    task.abort();
    Ok(())
}
