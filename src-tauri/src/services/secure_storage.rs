const SERVICE_NAME: &str = "com.clawchat.desktop.auth";
const MAX_KEY_LENGTH: usize = 128;

pub fn get(key: &str) -> Result<Option<String>, String> {
    let entry = entry(key)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("failed to read OS credential: {error}")),
    }
}

pub fn set(key: &str, value: &str) -> Result<(), String> {
    entry(key)?
        .set_password(value)
        .map_err(|error| format!("failed to save OS credential: {error}"))
}

pub fn remove(key: &str) -> Result<(), String> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("failed to remove OS credential: {error}")),
    }
}

fn entry(key: &str) -> Result<keyring::Entry, String> {
    validate_key(key)?;
    keyring::Entry::new(SERVICE_NAME, key)
        .map_err(|error| format!("failed to access OS credential store: {error}"))
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_KEY_LENGTH {
        return Err(format!(
            "credential key length must be between 1 and {MAX_KEY_LENGTH} bytes"
        ));
    }
    if !key
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err("credential key contains unsupported characters".to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_zustand_storage_key() {
        assert!(validate_key("auth-storage").is_ok());
    }

    #[test]
    fn rejects_empty_or_path_like_keys() {
        assert!(validate_key("").is_err());
        assert!(validate_key("../auth-storage").is_err());
        assert!(validate_key("auth/storage").is_err());
    }
}
