const LIB_SOURCE: &str = include_str!("../src/lib.rs");
const NATIVE_SOURCE: &str = include_str!("../src/native.rs");
const APP_COMMAND_SOURCE: &str = include_str!("../src/commands/app.rs");
const SERVER_COMMAND_SOURCE: &str = include_str!("../src/commands/server.rs");

#[test]
fn optional_native_integrations_do_not_fail_application_setup() {
    assert!(!LIB_SOURCE.contains("tauri_plugin_global_shortcut::Builder"));
    assert!(!LIB_SOURCE.contains("tauri_plugin_autostart::init"));
    assert!(NATIVE_SOURCE.contains("if let Err(error) = setup_tray(app)"));
    assert!(!NATIVE_SOURCE.contains("setup_tray(app)?"));
    assert!(NATIVE_SOURCE.contains("match app.plugin(global_shortcut_plugin)"));
    assert!(NATIVE_SOURCE.contains("match app.plugin(autostart_plugin)"));
}

#[test]
fn tray_uses_platform_specific_assets_without_reusing_the_app_icon() {
    assert!(NATIVE_SOURCE.contains("./icons/tray-template-macos.png"));
    assert!(NATIVE_SOURCE.contains("./icons/tray-color.png"));
    assert!(NATIVE_SOURCE.contains(".icon_as_template(cfg!(target_os = \"macos\"))"));
    assert!(!NATIVE_SOURCE.contains("default_window_icon()"));
}

#[test]
fn quick_capture_is_registered_only_after_the_plugin_initializes() {
    let plugin_success = NATIVE_SOURCE
        .find("match app.plugin(global_shortcut_plugin)")
        .expect("dynamic global shortcut plugin registration must remain in setup");
    let shortcut_registration = NATIVE_SOURCE
        .find("app.global_shortcut().register(QUICK_CAPTURE_SHORTCUT)")
        .expect("quick capture shortcut registration must remain in setup");
    let plugin_failure = NATIVE_SOURCE
        .find("global shortcut plugin is unavailable")
        .expect("plugin initialization failures must be logged");

    assert!(plugin_success < shortcut_registration);
    assert!(shortcut_registration < plugin_failure);
}

#[test]
fn native_integrations_are_deferred_until_after_ready() {
    let setup_hook = LIB_SOURCE
        .split_once(".setup(|app|")
        .and_then(|(_, remainder)| remainder.split_once(".invoke_handler"))
        .map(|(setup, _)| setup)
        .expect("application setup hook");

    assert!(!setup_hook.contains("native::setup"));
    assert!(LIB_SOURCE.contains("tauri::RunEvent::Ready"));
    assert!(LIB_SOURCE.contains("run_on_main_thread(move ||"));
    assert!(LIB_SOURCE.contains("native::setup(&deferred_app_handle)"));
}

#[test]
fn missing_application_state_has_a_non_panicking_exit_path() {
    assert!(LIB_SOURCE.contains("match AppState::initialize(app.handle())"));
    assert!(LIB_SOURCE.contains("failed to initialize application state: {error}"));
    assert!(LIB_SOURCE.contains("app.handle().exit(1)"));
    assert!(LIB_SOURCE.matches("try_state::<AppState>()").count() >= 3);
}

#[test]
fn autostart_commands_tolerate_an_unavailable_plugin() {
    assert!(SERVER_COMMAND_SOURCE.contains("app.try_state::<AutoLaunchManager>()"));
    assert!(SERVER_COMMAND_SOURCE.contains("skipped system autostart update: plugin unavailable"));
    assert!(!SERVER_COMMAND_SOURCE.contains("app.autolaunch()"));
}

#[test]
fn application_build_failure_is_logged_without_panicking() {
    assert!(LIB_SOURCE.contains("failed to build application: {error}"));
    assert!(LIB_SOURCE.contains("std::process::exit(1)"));
    assert!(!LIB_SOURCE.contains(".expect(\"error while building ClawChat\")"));
}

#[test]
fn disabled_preview_updater_is_a_noop() {
    assert!(APP_COMMAND_SOURCE
        .contains("Err(tauri_plugin_updater::Error::EmptyEndpoints) => return Ok(None)"));
}

#[test]
fn unix_termination_signals_exit_through_the_tauri_lifecycle() {
    assert!(LIB_SOURCE.contains("signal(SignalKind::terminate())"));
    assert!(LIB_SOURCE.contains("signal(SignalKind::interrupt())"));
    assert!(LIB_SOURCE.contains("app_handle.exit(0)"));
    assert!(LIB_SOURCE.contains("tauri::RunEvent::Exit =>"));
    assert!(LIB_SOURCE.contains("state.stop_server(app_handle)"));
}
