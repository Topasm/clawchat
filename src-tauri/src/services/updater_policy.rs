use url::Url;

pub const MAX_UPDATE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_SIGNATURE_BYTES: usize = 16 * 1024;
const MAX_RELEASE_NOTES_BYTES: usize = 256 * 1024;
const MAX_VERSION_BYTES: usize = 128;

pub fn validate_release_fields(
    download_url: &Url,
    signature: &str,
    release_notes: Option<&str>,
    version: &str,
) -> Result<(), String> {
    if version.is_empty() || version.len() > MAX_VERSION_BYTES || version.contains('\0') {
        return Err("the update manifest contains an invalid version".to_owned());
    }

    let trusted_transport = download_url.scheme() == "https"
        && download_url.host_str().is_some()
        && download_url.username().is_empty()
        && download_url.password().is_none();
    if !trusted_transport {
        return Err("the update manifest contains an untrusted download target".to_owned());
    }

    if signature.is_empty()
        || signature.trim() != signature
        || signature.len() > MAX_SIGNATURE_BYTES
        || signature.contains('\0')
    {
        return Err("the update manifest contains an invalid signature".to_owned());
    }

    if release_notes
        .is_some_and(|notes| notes.len() > MAX_RELEASE_NOTES_BYTES || notes.contains('\0'))
    {
        return Err("the update manifest release notes exceed the safety limit".to_owned());
    }

    Ok(())
}

pub fn exceeds_download_limit(downloaded: u64, content_length: Option<u64>) -> bool {
    downloaded > MAX_UPDATE_BYTES
        || content_length.is_some_and(|content_length| content_length > MAX_UPDATE_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_bounded_https_release_metadata() {
        let url = Url::parse("https://github.com/example/app/releases/download/v1/app.zip")
            .expect("valid URL");

        assert!(validate_release_fields(&url, "signed", Some("notes"), "1.0.0").is_ok());
    }

    #[test]
    fn rejects_insecure_or_credentialed_download_targets() {
        for target in [
            "http://example.com/app.zip",
            "https://user:secret@example.com/app.zip",
            "file:///tmp/app.zip",
        ] {
            let url = Url::parse(target).expect("valid test URL");
            assert!(validate_release_fields(&url, "signed", None, "1.0.0").is_err());
        }
    }

    #[test]
    fn rejects_unbounded_or_malformed_manifest_fields() {
        let url = Url::parse("https://example.com/app.zip").expect("valid URL");
        assert!(validate_release_fields(&url, "", None, "1.0.0").is_err());
        assert!(validate_release_fields(&url, " signed ", None, "1.0.0").is_err());
        assert!(validate_release_fields(&url, "signed", None, "").is_err());
        assert!(validate_release_fields(&url, "signed", Some("bad\0notes"), "1.0.0").is_err());
    }

    #[test]
    fn detects_declared_and_accumulated_oversized_packages() {
        assert!(!exceeds_download_limit(
            MAX_UPDATE_BYTES,
            Some(MAX_UPDATE_BYTES)
        ));
        assert!(exceeds_download_limit(
            1,
            Some(MAX_UPDATE_BYTES.saturating_add(1))
        ));
        assert!(exceeds_download_limit(
            MAX_UPDATE_BYTES.saturating_add(1),
            None
        ));
    }
}
