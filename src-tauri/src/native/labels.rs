//! The words on the native menus, in the renderer's language.
//!
//! The menu bar and the tray are built by Rust before the renderer has loaded
//! its catalog, so they start in English and are rebuilt once the renderer
//! reports its language (and again whenever the user changes it).

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Language {
    English,
    Korean,
}

impl Language {
    /// `ko`, `ko-KR` and the like are Korean; anything else reads as English.
    pub fn from_tag(tag: &str) -> Self {
        if tag.trim().to_ascii_lowercase().starts_with("ko") {
            Self::Korean
        } else {
            Self::English
        }
    }

    const fn code(self) -> u8 {
        match self {
            Self::English => 0,
            Self::Korean => 1,
        }
    }

    const fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Korean,
            _ => Self::English,
        }
    }
}

static CURRENT: AtomicU8 = AtomicU8::new(0);

pub(super) fn current() -> Language {
    Language::from_code(CURRENT.load(Ordering::Relaxed))
}

/// Remember the renderer's language; returns whether it changed.
pub(super) fn set_current(language: Language) -> bool {
    CURRENT.swap(language.code(), Ordering::Relaxed) != language.code()
}

/// Most of these are menu-bar items, which only macOS builds construct.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Label {
    Settings,
    Connections,
    OpenConnections,
    ShowClawChat,
    QuickCapture,
    OpenDiagnostics,
    HideClawChat,
    HideOthers,
    ShowAll,
    QuitClawChat,
    File,
    Edit,
    View,
    Window,
    Help,
    CloseWindow,
    StopServer,
    RestartServer,
}

pub(super) fn text(language: Language, label: Label) -> &'static str {
    match (language, label) {
        (Language::English, Label::Settings) => "Settings…",
        (Language::Korean, Label::Settings) => "설정…",
        (Language::English, Label::Connections) => "Connections…",
        (Language::Korean, Label::Connections) => "연결…",
        (Language::English, Label::OpenConnections) => "Open Connections…",
        (Language::Korean, Label::OpenConnections) => "연결 열기…",
        (Language::English, Label::ShowClawChat) => "Show ClawChat",
        (Language::Korean, Label::ShowClawChat) => "ClawChat 보기",
        (Language::English, Label::QuickCapture) => "Quick Capture",
        (Language::Korean, Label::QuickCapture) => "빠른 캡처",
        (Language::English, Label::OpenDiagnostics) => "Open Diagnostics",
        (Language::Korean, Label::OpenDiagnostics) => "진단 열기",
        (Language::English, Label::HideClawChat) => "Hide ClawChat",
        (Language::Korean, Label::HideClawChat) => "ClawChat 가리기",
        (Language::English, Label::HideOthers) => "Hide Others",
        (Language::Korean, Label::HideOthers) => "기타 가리기",
        (Language::English, Label::ShowAll) => "Show All",
        (Language::Korean, Label::ShowAll) => "모두 보기",
        (Language::English, Label::QuitClawChat) => "Quit ClawChat",
        (Language::Korean, Label::QuitClawChat) => "ClawChat 종료",
        (Language::English, Label::File) => "File",
        (Language::Korean, Label::File) => "파일",
        (Language::English, Label::Edit) => "Edit",
        (Language::Korean, Label::Edit) => "편집",
        (Language::English, Label::View) => "View",
        (Language::Korean, Label::View) => "보기",
        (Language::English, Label::Window) => "Window",
        (Language::Korean, Label::Window) => "윈도우",
        (Language::English, Label::Help) => "Help",
        (Language::Korean, Label::Help) => "도움말",
        (Language::English, Label::CloseWindow) => "Close Window",
        (Language::Korean, Label::CloseWindow) => "윈도우 닫기",
        (Language::English, Label::StopServer) => "Stop Server",
        (Language::Korean, Label::StopServer) => "서버 중지",
        (Language::English, Label::RestartServer) => "Restart Server",
        (Language::Korean, Label::RestartServer) => "서버 다시 시작",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn korean_tags_select_korean_and_everything_else_english() {
        assert_eq!(Language::from_tag("ko"), Language::Korean);
        assert_eq!(Language::from_tag("ko-KR"), Language::Korean);
        assert_eq!(Language::from_tag("en"), Language::English);
        assert_eq!(Language::from_tag(""), Language::English);
    }

    #[test]
    fn every_label_has_words_in_both_languages() {
        for label in [
            Label::Settings,
            Label::Connections,
            Label::OpenConnections,
            Label::ShowClawChat,
            Label::QuickCapture,
            Label::OpenDiagnostics,
            Label::HideClawChat,
            Label::HideOthers,
            Label::ShowAll,
            Label::QuitClawChat,
            Label::File,
            Label::Edit,
            Label::View,
            Label::Window,
            Label::Help,
            Label::CloseWindow,
            Label::StopServer,
            Label::RestartServer,
        ] {
            let english = text(Language::English, label);
            assert!(!english.is_empty());
            assert_ne!(english, text(Language::Korean, label));
        }
    }
}
