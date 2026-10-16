use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub const IMAGE_COUNT_LIMIT: usize = 4;
pub const IMAGE_BYTES_LIMIT: usize = 8 * 1024 * 1024;
pub const IMAGE_TOTAL_BYTES_LIMIT: usize = 12 * 1024 * 1024;
pub const IMAGE_PIXELS_LIMIT: u64 = 64 * 1024 * 1024;
pub const UPLOAD_CHUNK_BYTES: usize = 96 * 1024;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentReference {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: usize,
    pub width: u32,
    pub height: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StagedImage {
    #[serde(flatten)]
    pub reference: AttachmentReference,
    pub data: String,
}

pub fn references(input: &Value) -> Result<Vec<AttachmentReference>> {
    let Some(value) = input.get("attachments") else {
        return Ok(Vec::new());
    };
    let references: Vec<AttachmentReference> =
        serde_json::from_value(value.clone()).context("Invalid image attachments")?;
    validate_references(&references)?;
    Ok(references)
}

pub fn stage(dir: &Path, image: StagedImage) -> Result<AttachmentReference> {
    validate_reference(&image.reference)?;
    ensure!(
        image.data.len() <= IMAGE_BYTES_LIMIT / 3 * 4 + 4,
        "Image data is too large"
    );
    let bytes = STANDARD
        .decode(image.data)
        .context("Image data is not valid base64")?;
    ensure!(
        bytes.len() == image.reference.size,
        "Image size changed while attaching"
    );
    let (width, height) = image_dimensions(&bytes, &image.reference.mime_type)?;
    ensure!(
        width == image.reference.width && height == image.reference.height,
        "Image dimensions changed while attaching"
    );
    ensure_dir(dir)?;
    let target = attachment_path(dir, &image.reference.id);
    let temporary = target.with_extension("tmp");
    fs::write(&temporary, bytes)?;
    fs::rename(temporary, target)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            attachment_path(dir, &image.reference.id),
            fs::Permissions::from_mode(0o600),
        )?;
    }
    Ok(image.reference)
}

fn image_dimensions(bytes: &[u8], mime_type: &str) -> Result<(u32, u32)> {
    let invalid = || anyhow::anyhow!("Image data does not match its attachment metadata");
    match mime_type {
        "image/png" => {
            ensure!(bytes.len() >= 24 && &bytes[..8] == b"\x89PNG\r\n\x1a\n" && &bytes[12..16] == b"IHDR", "Image data does not match its attachment metadata");
            Ok((u32::from_be_bytes(bytes[16..20].try_into().unwrap()), u32::from_be_bytes(bytes[20..24].try_into().unwrap())))
        }
        "image/gif" => {
            ensure!(bytes.len() >= 10 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a"), "Image data does not match its attachment metadata");
            Ok((u16::from_le_bytes(bytes[6..8].try_into().unwrap()) as u32, u16::from_le_bytes(bytes[8..10].try_into().unwrap()) as u32))
        }
        "image/jpeg" => {
            ensure!(bytes.len() >= 4 && bytes[..2] == [0xff, 0xd8], "Image data does not match its attachment metadata");
            let mut offset = 2;
            while offset + 9 < bytes.len() {
                ensure!(bytes[offset] == 0xff, "Image data does not match its attachment metadata");
                offset += 1;
                while bytes.get(offset) == Some(&0xff) { offset += 1; }
                let marker = *bytes.get(offset).ok_or_else(invalid)?;
                offset += 1;
                if marker == 0xd9 || marker == 0xda { break; }
                let length = u16::from_be_bytes(bytes.get(offset..offset + 2).ok_or_else(invalid)?.try_into().unwrap()) as usize;
                ensure!(length >= 2 && offset + length <= bytes.len(), "Image data does not match its attachment metadata");
                if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
                    return Ok((u16::from_be_bytes(bytes[offset + 5..offset + 7].try_into().unwrap()) as u32, u16::from_be_bytes(bytes[offset + 3..offset + 5].try_into().unwrap()) as u32));
                }
                offset += length;
            }
            Err(invalid())
        }
        "image/webp" => {
            ensure!(bytes.len() >= 20 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP", "Image data does not match its attachment metadata");
            let mut offset = 12;
            while offset + 8 <= bytes.len() {
                let kind = &bytes[offset..offset + 4];
                let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
                let data = offset + 8;
                ensure!(data + size <= bytes.len(), "Image data does not match its attachment metadata");
                if kind == b"VP8X" && size >= 10 {
                    return Ok((1 + bytes[data + 4] as u32 + ((bytes[data + 5] as u32) << 8) + ((bytes[data + 6] as u32) << 16), 1 + bytes[data + 7] as u32 + ((bytes[data + 8] as u32) << 8) + ((bytes[data + 9] as u32) << 16)));
                }
                if kind == b"VP8L" && size >= 5 && bytes[data] == 0x2f {
                    let bits = u32::from_le_bytes(bytes[data + 1..data + 5].try_into().unwrap());
                    return Ok((1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)));
                }
                if kind == b"VP8 " && size >= 10 && bytes[data + 3..data + 6] == [0x9d, 0x01, 0x2a] {
                    return Ok(((u16::from_le_bytes(bytes[data + 6..data + 8].try_into().unwrap()) & 0x3fff) as u32, (u16::from_le_bytes(bytes[data + 8..data + 10].try_into().unwrap()) & 0x3fff) as u32));
                }
                offset = data + size + size % 2;
            }
            Err(invalid())
        }
        _ => Err(invalid()),
    }
}

pub fn read(dir: &Path, reference: &AttachmentReference) -> Result<Vec<u8>> {
    validate_reference(reference)?;
    let bytes = fs::read(attachment_path(dir, &reference.id))
        .context("Attached image is no longer available. Attach it again.")?;
    ensure!(
        bytes.len() == reference.size,
        "Attached image changed; attach it again"
    );
    Ok(bytes)
}

pub fn clear(dir: &Path, references: &[AttachmentReference]) {
    for reference in references {
        let _ = fs::remove_file(attachment_path(dir, &reference.id));
    }
}

pub fn discard(dir: &Path, references: &[AttachmentReference]) -> Result<()> {
    validate_references(references)?;
    clear(dir, references);
    Ok(())
}

fn validate_references(references: &[AttachmentReference]) -> Result<()> {
    ensure!(
        references.len() <= IMAGE_COUNT_LIMIT,
        "Attach up to four images at once"
    );
    let mut total = 0usize;
    let mut ids = std::collections::BTreeSet::new();
    for reference in references {
        validate_reference(reference)?;
        ensure!(
            ids.insert(&reference.id),
            "Image attachment IDs must be unique"
        );
        total = total
            .checked_add(reference.size)
            .context("Images are too large")?;
    }
    ensure!(
        total <= IMAGE_TOTAL_BYTES_LIMIT,
        "Attached images must total 12 MB or smaller"
    );
    Ok(())
}

fn validate_reference(reference: &AttachmentReference) -> Result<()> {
    ensure!(
        !reference.id.is_empty()
            && reference.id.len() <= 80
            && reference
                .id
                .bytes()
                .all(|value| value.is_ascii_alphanumeric() || value == b'_' || value == b'-'),
        "Invalid image attachment ID"
    );
    ensure!(
        !reference.name.trim().is_empty()
            && reference.name.len() <= 255
            && reference
                .name
                .chars()
                .all(|character| !matches!(character, '/' | '\\' | '\0')),
        "Invalid image name"
    );
    ensure!(
        matches!(
            reference.mime_type.as_str(),
            "image/png" | "image/jpeg" | "image/gif" | "image/webp"
        ),
        "Unsupported image type"
    );
    ensure!(
        reference.size > 0 && reference.size <= IMAGE_BYTES_LIMIT,
        "Each image must be 8 MB or smaller"
    );
    ensure!(
        reference.width > 0
            && reference.height > 0
            && u64::from(reference.width) * u64::from(reference.height) <= IMAGE_PIXELS_LIMIT,
        "Each image must be 64 megapixels or smaller"
    );
    Ok(())
}

fn ensure_dir(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn attachment_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.image"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JZCkAAAAASUVORK5CYII=";

    fn image(data: &str) -> StagedImage {
        StagedImage {
            reference: AttachmentReference {
                id: "image-one".into(),
                name: "Screen.png".into(),
                mime_type: "image/png".into(),
                size: 68,
                width: 1,
                height: 1,
            },
            data: data.into(),
        }
    }

    #[test]
    fn stages_only_bounded_safe_images() {
        let directory = std::env::temp_dir().join(format!(
            "monocode-companion-image-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        let reference = stage(&directory, image(PNG)).unwrap();
        assert_eq!(read(&directory, &reference).unwrap().len(), 68);
        assert!(stage(&directory, image("wrong")).is_err());
        clear(&directory, &[reference]);
        assert!(read(&directory, &image(PNG).reference).is_err());
        fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn validates_persisted_references_without_payloads() {
        let input = serde_json::json!({"attachments":[{"id":"image-one","name":"Screen.png","mimeType":"image/png","size":68,"width":1,"height":1}]});
        assert_eq!(references(&input).unwrap().len(), 1);
        assert!(references(&serde_json::json!({"attachments":[{"id":"../bad","name":"Screen.png","mimeType":"image/png","size":68,"width":1,"height":1}]})).is_err());
    }

    #[test]
    fn native_stage_payload_rejects_browser_preview_fields_and_bad_metadata() {
        let payload = serde_json::json!({"id":"image-one","name":"Screen.png","mimeType":"image/png","size":68,"width":1,"height":1,"data":PNG});
        assert!(serde_json::from_value::<StagedImage>(payload.clone()).is_ok());
        let mut preview = payload.clone();
        preview["previewUrl"] = serde_json::json!("blob:private");
        assert!(serde_json::from_value::<StagedImage>(preview).is_err());
        let mut mismatch = payload;
        mismatch["width"] = serde_json::json!(2);
        let directory = std::env::temp_dir().join(format!("monocode-companion-image-metadata-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        assert!(stage(&directory, serde_json::from_value(mismatch).unwrap()).is_err());
        let _ = fs::remove_dir_all(&directory);
    }
}
