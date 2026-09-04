# 머신별 작업 경로와 "어디서 도는가" — 계획과 판단

작성일: 2026-09-04
목표: 프로젝트마다 **어느 머신의 어느 폴더에서 일하는지**를 1급 정보로 만들고, 그 폴더의 컨텍스트가
채팅과 에이전트 실행에 자동으로 따라오게 하며, 화면 어디서나 "지금 무엇이 어디서 도는지" 보이게 한다.
ChatGPT 데스크톱의 프로젝트(머신 연결 점 + 스레드 + "Ran command") 모델이 기준.

관련 지시서: `research-branch-workflow_ko.md`(W1–W6, 별도 담당). 이 문서는 그와 독립.

## 1. 현재 상태 (있는 것 / 없는 것)

| 부품 | 상태 | 위치 |
|---|---|---|
| 실행 호스트 등록(머신 = 라벨·플랫폼·last_seen) | 있음 | 설정 → "이 머신이 작업 실행"(워커 토글, 라벨, 프로바이더) |
| 프로젝트별 **호스트별 경로** + 실행 호스트 선택 | 있음 (묻혀 있음) | 프로젝트 페이지 하단 "Where this runs" — 경로 입력, "Run here" |
| 워커: 그 머신에서 CLI 실행, 쓰기는 경로 안으로 제한 | 있음 | `workerRunner.ts` + Rust shell, 4초 폴링, heartbeat |
| 오프라인 머신에 큐잉 거부 | 있음 | `EXECUTION_HOST_UNAVAILABLE` |
| 폴더 선택 다이얼로그 | 있음(vault용) | `platformApi.server.selectFolder` |
| run이 **어느 머신에서** 도는지 표시 | 없음 (Paseo만 host_id 표시) | RunCard, RunStatusCard, Attention, 스레드 |
| 프로젝트 카드/헤더에 머신·온라인 표시 | 없음 | ChatListPage, ProjectWorkspacePage |
| 폴더 내용이 채팅/실행 컨텍스트로 들어감 | 없음 (Obsidian vault 컨텍스트만) | `conversation_context`, `run_context_service` |
| 프로젝트 생성 시 경로 바인딩 | 없음 (생성 후 하단에서 따로) | 새 프로젝트 다이얼로그 |

즉 "경로 지정 옵션이 없다"는 인상은 **위치와 순서** 문제다. 부품은 있지만 프로젝트를 만들 때 묻지 않고,
만든 뒤에도 하단에 있으며, 어디서 도는지는 어느 화면에도 안 나온다.

## 2. 운용 모델 (두 머신)

```
Ubuntu (실험)  = 서버 호스트 + 워커 "ubuntu-lab"     경로: ~/Desktop/srp_e65, ~/Desktop/semtok_wam …
Mac (기록/논문) = 클라이언트(호스트 서버 URL/릴레이) + 워커 "mac"   경로: ~/Papers/icra2026 …
```

- 서버는 Ubuntu 하나. Mac 앱은 Ubuntu 서버에 붙고(LAN 또는 릴레이) **자기 머신의 워커**로 등록한다.
- 프로젝트마다 실행 호스트를 하나 고른다. 실험 프로젝트 → ubuntu-lab, 논문 프로젝트 → mac.
  같은 프로젝트에 두 머신 경로를 둘 다 등록해 두고 실행 호스트만 바꿀 수도 있다(이미 지원).
- 컨텍스트는 **경로가 있는 머신의 워커가 읽어 서버로 올린다**(서버는 Mac 파일을 못 읽는다).
- 결과는 서버의 아티팩트/리포트로 봉인되어 어디서든 보인다. 이것이 두 머신 사이의 기본 공유 경로.

## 3. 판단: SSH로 서로 가져오기는 지금 하지 않는다

- 이유 1: 위 모델에서 "일한 결과"는 아티팩트로 이미 서버에 모인다. 필요한 공유의 80%는 이걸로 끝난다.
- 이유 2: 워커가 돌리는 CLI(claude/codex)는 그 머신의 셸을 쓰므로, 사용자의 `~/.ssh/config`가 있으면
  instruction에 "`scp mac:~/Papers/…` 로 가져와라"라고 적는 것만으로 이미 가능하다. ClawChat이 SSH를
  중개할 필요가 없다. 대신 프로젝트 실행 규칙(W3)에 허용 호스트를 적어 두는 것으로 충분.
- 후보(보류): 워커 간 "파일 가져오기"를 서버 릴레이로 중개하는 명령. 릴레이 대역폭·암호화·경로 제한이
  걸리는 큰 기능이라, 실제로 막히는 사례가 나온 뒤에 한다.

## 4. 작업 항목

### M1. "어디서 도는가"를 모든 run 표면에 표시 (소)

- 서버: `AgentRunResponse.host_label`(execution_host join; Paseo는 기존 host_id), `run_state_changed`
  페이로드에 `host_label`, `ProjectResponse.execution_host_label` + `execution_host_online`.
- 웹: `RunCard`/`RunStatusCard`/Attention 항목에 "on ubuntu-lab" 칩. 프로젝트 카드(ChatListPage)와
  프로젝트 헤더에 머신 이름 + 온라인 점(초록/회색, `last_seen_at` 기준 5분). ChatPage 스코프 배너에
  "실행: ubuntu-lab · ~/Desktop/srp_e65".
- Android: run 카드에 host_label 텍스트 한 줄.
- 수용: 워커 run을 시작하면 스레드 카드와 Attention에 머신 이름이 보인다. 머신을 끄면 프로젝트 카드 점이 회색.

### M2. 프로젝트 생성/헤더에서 경로 바인딩을 1단계로 (중)

- "+ 프로젝트" 다이얼로그에 "이 머신의 폴더" 필드 + 폴더 선택(데스크톱: `selectFolder`; 웹: 경로 입력).
  생성 직후 `PUT /projects/{id}/workspace/paths` + `PUT /projects/{id}/workspace/host`를 순서대로 호출.
- 이 머신이 아직 워커로 등록되지 않았으면 다이얼로그 안에서 "이 머신을 실행 머신으로 등록" 토글
  (설정의 워커 토글과 같은 스토어) — 라벨 기본값은 hostname.
- 프로젝트 헤더(`ProjectIdentity` 아래)에 "ubuntu-lab · ~/Desktop/srp_e65 [변경]" 한 줄. 클릭 시 기존
  "Where this runs" 섹션으로 스크롤.
- 인박스 트리의 "+ 작업"과 "Discuss with agent"는 그대로.
- 수용: 새 프로젝트를 폴더와 함께 만들면 즉시 Ready 작업을 그 머신에서 실행할 수 있다.

### M3. 폴더 컨텍스트 스냅샷 — 경로가 채팅·실행에 따라옴 (중~대)

- 데이터: `project_host_paths.context_text`(Text, ≤ 24 KB), `context_updated_at`, `context_files`(JSON:
  읽은 파일 목록). 마이그레이션 1개.
- API: `PUT /projects/{id}/workspace/context` (host_id, files[{path, text}]) — 워커만 호출.
- 워커(렌더러 + Rust): 바운드 경로에서 아래 순서로 존재하는 것만 읽어 합계 24 KB까지:
  `.clawchat/CONTEXT.md`(있으면 이것만) → `README*.md` → `docs/INDEX*.md` → `WORKSPACE_INDEX*.md`.
  Rust 커맨드 `worker_read_context(path)`는 경로 밖 접근 금지, 심볼릭 링크 불추적, 파일당 8 KB 절단.
- 갱신 시점: 워커 등록 직후(앱 시작), run claim 직전(자동), 프로젝트 페이지 "컨텍스트 새로고침" 버튼.
- 소비: `build_first_class_project_context`에 `[Workspace ubuntu-lab: ~/Desktop/srp_e65]` 블록(요약 상단
  N자), `run_context_service.build_execution_instruction`에 같은 블록(`[Project rules]` 다음).
- 수용: 프로젝트 채팅에서 "이 폴더 구조 설명해줘"에 README 내용으로 답한다. 실행 instruction 스냅샷에
  워크스페이스 블록이 들어 있다. Mac 경로 프로젝트는 Mac 워커가 올린 컨텍스트를 Ubuntu 서버가 보여 준다.

### M4. 머신 상태를 앱 상단에 (소)

- 사이드바 하단(연결 상태 옆)에 "이 머신: ubuntu-lab · 대기 중 / 실행 중 E65a" — 워커 상태 스토어에
  현재 job 제목을 넣는다(`workerRunner` → store). 클릭 시 설정의 워커 섹션.
- 실행 중이면 사이드바 점이 깜빡이고, Attention 배지와 별개로 "지금 이 머신이 하는 일"이 보인다.

### M5. 폴더별 정리 대비 (규칙만)

- 연구 폴더 하나 = 프로젝트 하나. 프로젝트당 호스트별 경로는 1개(현 구조 유지).
- 여러 폴더를 참조해야 하면 `.clawchat/CONTEXT.md`에 링크를 적는다(M3가 읽음). 읽기 전용 추가 경로
  (`extra_read_paths`)는 필요가 확인되면 추가.

### M6. 크로스 머신 파일 참조 — 보류 (3절)

## 5. 순서와 크기

M1(소) → M2(중) → M3(중~대, 마이그레이션 1개 + Rust 커맨드 1개) → M4(소). M5/M6 보류.
M1과 M2는 독립이라 병렬 가능. M3는 M2 이후(경로가 먼저 바인딩되어야 읽을 대상이 생김).

## 6. 검증 시나리오

1. Ubuntu에서 프로젝트 "srp_e65"를 폴더와 함께 생성 → 헤더에 "ubuntu-lab · ~/Desktop/srp_e65".
2. Mac 앱을 Ubuntu 서버에 붙이고 워커 "mac" 등록 → 프로젝트 "icra2026"을 `~/Papers/icra2026`으로 생성.
3. 두 프로젝트 카드에 각각 머신 이름과 온라인 점. Mac을 닫으면 icra2026 점이 회색, 그 프로젝트의
   Ready 실행은 `EXECUTION_HOST_UNAVAILABLE`로 거부.
4. srp_e65 채팅에서 "이 폴더에서 다음 실험 뭐야?" → README/INDEX 내용을 근거로 답.
5. E65a 위임 → 사이드바 "이 머신: ubuntu-lab · 실행 중 E65a" → 스레드 카드 "on ubuntu-lab" → 승인 후
   리포트 아티팩트를 Mac에서 열람.

## 7. 진행 상황 (2026-09-04)

| 항목 | 상태 | 커밋 | 계획과 다른 점 |
| --- | --- | --- | --- |
| M1 | 완료 | `dbc46dd` | 없음. run `host_label`, 프로젝트 `execution_host_label/online`, 웹·Android 표면 모두 표시 |
| M2 | 완료 | `1210a6c` | "이 머신 등록" 토글의 라벨 기본값은 hostname이 아니라 OS별 기본 이름(`My Mac` 등). hostname용 Rust 커맨드는 로컬에 cargo가 없어 보류 |
| M3 | 완료 | `e75d202` | 한도는 KB가 아니라 문자 수(서버 8,000/24,000, Rust 8/24 KiB). 채팅 컨텍스트는 4,000자로 더 짧게. "컨텍스트 새로고침" 버튼은 이 앱이 그 프로젝트의 실행 머신일 때만 보임(다른 머신 폴더는 그 머신만 읽을 수 있음) |
| M4 | 완료 | `5e35e22` | 사이드바 줄은 데스크톱 + 워커 켜짐일 때만. 클릭 시 `/settings#this-machine` |
| M5 | 규칙만 | — | 4절 그대로. `extra_read_paths`는 필요 확인 전까지 추가하지 않음 |
| M6 | 보류 | — | 3절 판단 유지 |

남은 확인: 설치된 데스크톱 앱은 새 빌드(Build Tauri Preview)로 교체해야 M3의 Rust 커맨드가 동작한다.
