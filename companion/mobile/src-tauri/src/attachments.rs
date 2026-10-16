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

    fn image(data: &str) -> StagedImage {
        StagedImage {
            reference: AttachmentReference {
                id: "image-one".into(),
                name: "Screen.png".into(),
                mime_type: "image/png".into(),
                size: 5,
                width: 2,
                height: 2,
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
        let reference = stage(&directory, image("aGVsbG8=")).unwrap();
        assert_eq!(read(&directory, &reference).unwrap(), b"hello");
        assert!(stage(&directory, image("wrong")).is_err());
        clear(&directory, &[reference]);
        assert!(read(&directory, &image("aGVsbG8=").reference).is_err());
        fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn validates_persisted_references_without_payloads() {
        let input = serde_json::json!({"attachments":[{"id":"image-one","name":"Screen.png","mimeType":"image/png","size":5,"width":2,"height":2}]});
        assert_eq!(references(&input).unwrap().len(), 1);
        assert!(references(&serde_json::json!({"attachments":[{"id":"../bad","name":"Screen.png","mimeType":"image/png","size":5,"width":2,"height":2}]})).is_err());
    }
}
