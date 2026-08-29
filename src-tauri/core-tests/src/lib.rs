#![allow(dead_code)]

mod startup_log {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/startup_log.rs"));
}

mod models {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/models.rs"));
}

mod services {
    pub mod config {
        include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/services/config.rs"));
    }

    pub mod migration {
        include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/services/migration.rs"));
    }

    pub mod secure_storage {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/services/secure_storage.rs"
        ));
    }

    pub mod server_supervisor {
        include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/services/server_supervisor.rs"));
    }

    pub mod updater_policy {
        include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/services/updater_policy.rs"));
    }
}
