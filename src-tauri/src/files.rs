//! Bounded, format-validated file I/O shared by desktop commands and native tests.
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};

pub const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_PROJECT_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_PNG_BYTES: u64 = 256 * 1024 * 1024;
const MAX_DIMENSION: u32 = 65_535;
const MAX_PIXELS: u64 = 160_000_000;
const MAX_DECODE_ALLOCATION: u64 = 768 * 1024 * 1024;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintSource {
    pub name: String,
    pub mime_type: &'static str,
    pub data_url: String,
    pub width_px: u32,
    pub height_px: u32,
}

fn io_error(operation: &str, error: std::io::Error) -> String {
    // ErrorKind communicates the action needed without logging the user's path.
    format!(
        "Could not {operation} ({:?}). Check the file and folder permissions.",
        error.kind()
    )
}

fn validate_path(path: &Path, extensions: &[&str]) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Choose an absolute file path.".into());
    }
    for component in path.components() {
        match component {
            Component::ParentDir => return Err("Parent-directory traversal is not allowed.".into()),
            Component::Normal(name) => {
                let text = name.to_string_lossy();
                if text.contains(['\0', ':']) {
                    return Err("The file path contains an unsupported character.".into());
                }
                #[cfg(windows)]
                {
                    if text.ends_with([' ', '.']) {
                        return Err(
                            "Windows path components cannot end with spaces or dots.".into()
                        );
                    }
                    let stem = text
                        .split('.')
                        .next()
                        .unwrap_or_default()
                        .to_ascii_uppercase();
                    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                        || (stem.len() == 4
                            && (stem.starts_with("COM") || stem.starts_with("LPT"))
                            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
                    {
                        return Err("Windows device paths are not supported.".into());
                    }
                }
            }
            #[cfg(windows)]
            Component::Prefix(prefix)
                if matches!(
                    prefix.kind(),
                    std::path::Prefix::DeviceNS(_) | std::path::Prefix::Verbatim(_)
                ) =>
            {
                return Err("Windows device paths are not supported.".into());
            }
            _ => {}
        }
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extensions
        .iter()
        .any(|allowed| extension.eq_ignore_ascii_case(allowed))
    {
        return Err(format!(
            "Unsupported file extension. Choose {}.",
            extensions.join(" / ")
        ));
    }
    Ok(())
}

fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|error| io_error("open the file", error))?;
    let metadata = file
        .metadata()
        .map_err(|error| io_error("inspect the file", error))?;
    if !metadata.is_file() {
        return Err("Choose a regular file.".into());
    }
    if metadata.len() == 0 || metadata.len() > limit {
        return Err(format!(
            "The file is empty or exceeds the {} MiB limit.",
            limit / 1024 / 1024
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| io_error("read the file", error))?;
    if bytes.is_empty() || bytes.len() as u64 > limit {
        return Err("The file changed during reading or exceeds the size limit.".into());
    }
    Ok(bytes)
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err(
            "Image dimensions exceed 65,535 pixels per side or 160 million pixels total.".into(),
        );
    }
    Ok(())
}

fn inspect_image(bytes: &[u8], format: ImageFormat) -> Result<(u32, u32), String> {
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(MAX_DECODE_ALLOCATION);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| "The image header is damaged or unsupported.".to_string())?;
    let (width, height) = decoder.dimensions();
    validate_dimensions(width, height)?;
    let orientation = decoder
        .orientation()
        .map_err(|_| "The image orientation metadata is damaged.".to_string())?;
    // Validate the encoded pixel stream, then immediately drop CPU pixels. Original bytes stay intact.
    drop(DynamicImage::from_decoder(decoder).map_err(|_| {
        "The image pixel data is damaged or exceeds the decode memory limit.".to_string()
    })?);
    if matches!(orientation.to_exif(), 5..=8) {
        Ok((height, width))
    } else {
        Ok((width, height))
    }
}

pub fn open_image(path: &Path) -> Result<PrintSource, String> {
    validate_path(path, &["png", "jpg", "jpeg", "webp"])?;
    let bytes = read_limited(path, MAX_IMAGE_BYTES)?;
    let format = image::guess_format(&bytes)
        .map_err(|_| "The file is not a valid PNG, JPEG, or WebP image.".to_string())?;
    let (mime_type, expected_extensions): (&str, &[&str]) = match format {
        ImageFormat::Png => ("image/png", &["png"]),
        ImageFormat::Jpeg => ("image/jpeg", &["jpg", "jpeg"]),
        ImageFormat::WebP => ("image/webp", &["webp"]),
        _ => return Err("Only PNG, JPEG, and WebP images are supported.".into()),
    };
    validate_path(path, expected_extensions)?;
    let (width_px, height_px) = inspect_image(&bytes, format)?;
    let name = path
        .file_name()
        .ok_or("The image has no filename.")?
        .to_string_lossy()
        .into_owned();
    Ok(PrintSource {
        name,
        mime_type,
        data_url: format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)),
        width_px,
        height_px,
    })
}

fn validate_project(contents: &str) -> Result<(), String> {
    if contents.is_empty() || contents.len() as u64 > MAX_PROJECT_BYTES {
        return Err("The project is empty or exceeds the 256 MiB limit.".into());
    }
    let value: serde_json::Value = serde_json::from_str(contents)
        .map_err(|_| "The project contains invalid JSON.".to_string())?;
    if !value.is_object() {
        return Err("A project must contain a JSON object.".into());
    }
    Ok(())
}

pub fn open_project(path: &Path) -> Result<String, String> {
    validate_path(path, &["matvision"])?;
    let bytes = read_limited(path, MAX_PROJECT_BYTES)?;
    let contents =
        String::from_utf8(bytes).map_err(|_| "The project is not valid UTF-8 text.".to_string())?;
    validate_project(&contents)?;
    Ok(contents)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<String, String> {
    let parent = path
        .parent()
        .ok_or("Choose a file inside an existing folder.")?;
    let parent =
        fs::canonicalize(parent).map_err(|error| io_error("open the destination folder", error))?;
    let filename = path.file_name().ok_or("Choose a destination filename.")?;
    let target: PathBuf = parent.join(filename);
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(
                "The destination must be a regular file, not a folder or symbolic link.".into(),
            );
        }
    }
    let mut temporary = tempfile::Builder::new()
        .prefix(".matvision-")
        .tempfile_in(&parent)
        .map_err(|error| io_error("create a temporary save file", error))?;
    temporary
        .write_all(bytes)
        .map_err(|error| io_error("write the file", error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| io_error("flush the file", error))?;
    // tempfile uses atomic replace semantics on Windows too, without deleting the old target first.
    let persisted = temporary
        .persist(&target)
        .map_err(|error| io_error("replace the destination file", error.error))?;
    persisted
        .sync_all()
        .map_err(|error| io_error("flush the saved file", error))?;
    Ok(path.to_string_lossy().into_owned())
}

pub fn save_project(contents: &str, path: &Path) -> Result<String, String> {
    validate_path(path, &["matvision"])?;
    validate_project(contents)?;
    atomic_write(path, contents.as_bytes())
}

pub fn save_png(bytes: &[u8], path: &Path) -> Result<String, String> {
    validate_path(path, &["png"])?;
    if bytes.len() as u64 > MAX_PNG_BYTES || !bytes.starts_with(PNG_SIGNATURE) {
        return Err("The export must be valid PNG data below 256 MiB.".into());
    }
    inspect_image(bytes, ImageFormat::Png)?;
    atomic_write(path, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory() -> tempfile::TempDir {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/native-test-data");
        fs::create_dir_all(&root).unwrap();
        tempfile::Builder::new()
            .prefix("native-")
            .tempdir_in(root)
            .unwrap()
    }

    fn encoded(format: ImageFormat) -> Vec<u8> {
        let image = DynamicImage::ImageRgb8(image::RgbImage::from_fn(3, 2, |x, y| {
            image::Rgb([(x * 70) as u8, (y * 110) as u8, 80])
        }));
        let mut buffer = Cursor::new(Vec::new());
        image.write_to(&mut buffer, format).unwrap();
        buffer.into_inner()
    }

    #[test]
    fn imports_png_jpeg_webp_with_original_bytes_and_dimensions() {
        let directory = directory();
        for (format, extension, mime) in [
            (ImageFormat::Png, "png", "image/png"),
            (ImageFormat::Jpeg, "jpeg", "image/jpeg"),
            (ImageFormat::WebP, "webp", "image/webp"),
        ] {
            let path = directory
                .path()
                .join(format!("Принт с пробелами.{extension}"));
            let bytes = encoded(format);
            fs::write(&path, &bytes).unwrap();
            let source = open_image(&path).unwrap();
            assert_eq!((source.width_px, source.height_px), (3, 2));
            assert_eq!(source.mime_type, mime);
            assert_eq!(
                source.data_url,
                format!("data:{mime};base64,{}", STANDARD.encode(bytes))
            );
            assert!(source.name.starts_with("Принт с пробелами."));
        }
    }

    #[test]
    fn jpeg_exif_orientation_reports_display_dimensions_without_reencoding() {
        let directory = directory();
        let jpeg = encoded(ImageFormat::Jpeg);
        let mut exif =
            b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0".to_vec();
        let mut oriented = jpeg[..2].to_vec();
        oriented.extend_from_slice(&[0xff, 0xe1]);
        oriented.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        oriented.append(&mut exif);
        oriented.extend_from_slice(&jpeg[2..]);
        let path = directory.path().join("oriented.jpg");
        fs::write(&path, &oriented).unwrap();
        let source = open_image(&path).unwrap();
        assert_eq!((source.width_px, source.height_px), (2, 3));
        assert_eq!(
            source.data_url,
            format!("data:image/jpeg;base64,{}", STANDARD.encode(oriented))
        );
    }

    #[test]
    fn rejects_extension_signature_mismatch_and_damaged_pixels() {
        let directory = directory();
        let wrong_extension = directory.path().join("wrong.jpg");
        let bytes = encoded(ImageFormat::Png);
        fs::write(&wrong_extension, &bytes).unwrap();
        assert!(open_image(&wrong_extension).is_err());
        let damaged = directory.path().join("damaged.png");
        fs::write(&damaged, &bytes[..bytes.len() / 2]).unwrap();
        assert!(open_image(&damaged).is_err());
        fs::write(&damaged, b"this is not an image").unwrap();
        assert!(open_image(&damaged).is_err());
    }

    #[test]
    fn bounds_files_before_reading_and_rejects_empty_files() {
        let directory = directory();
        let path = directory.path().join("file.png");
        fs::write(&path, [0u8; 17]).unwrap();
        assert!(read_limited(&path, 16).is_err());
        fs::write(&path, []).unwrap();
        assert!(read_limited(&path, 16).is_err());
    }

    #[test]
    fn protects_decoded_pixel_and_dimension_limits() {
        assert!(validate_dimensions(16_000, 10_000).is_ok());
        assert!(validate_dimensions(16_001, 10_000).is_err());
        assert!(validate_dimensions(65_536, 1).is_err());
        assert!(validate_dimensions(0, 1).is_err());
    }

    #[test]
    fn saves_reopens_and_atomically_overwrites_unicode_project() {
        let directory = directory();
        let path = directory.path().join("Проект мой коврик.matvision");
        let first = r#"{"format":"matvision-project","version":1,"state":{"name":"Первый"}}"#;
        let second = r#"{"format":"matvision-project","version":1,"state":{"name":"Второй"}}"#;
        assert_eq!(save_project(first, &path).unwrap(), path.to_string_lossy());
        assert_eq!(open_project(&path).unwrap(), first);
        save_project(second, &path).unwrap();
        assert_eq!(open_project(&path).unwrap(), second);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn invalid_project_save_preserves_previous_file() {
        let directory = directory();
        let path = directory.path().join("project.matvision");
        save_project(r#"{"version":1}"#, &path).unwrap();
        assert!(save_project("{broken", &path).is_err());
        assert_eq!(open_project(&path).unwrap(), r#"{"version":1}"#);
        assert!(save_project("[]", &path).is_err());
    }

    #[test]
    fn rejects_malformed_json_utf8_and_wrong_project_extension() {
        let directory = directory();
        let path = directory.path().join("invalid.matvision");
        fs::write(&path, [0xff, 0xfe, 0xfd]).unwrap();
        assert!(open_project(&path).unwrap_err().contains("UTF-8"));
        fs::write(&path, b"{invalid}").unwrap();
        assert!(open_project(&path).unwrap_err().contains("JSON"));
        assert!(save_project("{}", &directory.path().join("project.txt")).is_err());
    }

    #[test]
    fn exports_valid_png_and_preserves_it_on_invalid_replacement() {
        let directory = directory();
        let path = directory.path().join("Превью с пробелами.png");
        let bytes = encoded(ImageFormat::Png);
        save_png(&bytes, &path).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert!(save_png(b"not PNG", &path).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert!(save_png(&bytes[..12], &path).is_err());
        assert!(save_png(&bytes, &directory.path().join("preview.jpg")).is_err());
    }

    #[test]
    fn rejects_relative_traversing_and_non_file_destinations() {
        let directory = directory();
        assert!(save_project("{}", Path::new("relative.matvision")).is_err());
        assert!(save_project("{}", &directory.path().join("../escape.matvision")).is_err());
        let folder = directory.path().join("folder.matvision");
        fs::create_dir(&folder).unwrap();
        assert!(save_project("{}", &folder).is_err());
        assert!(save_project("{}", &directory.path().join("missing/project.matvision")).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_devices_and_alternate_streams() {
        assert!(validate_path(Path::new(r"C:\NUL.png"), &["png"]).is_err());
        assert!(validate_path(Path::new(r"C:\safe.png:other.png"), &["png"]).is_err());
        assert!(validate_path(Path::new(r"\\.\C:\safe.png"), &["png"]).is_err());
    }
}
