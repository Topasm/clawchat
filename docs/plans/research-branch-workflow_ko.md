# 연구 갈래·실험을 ClawChat으로 운용하기 — 작업 지시서

작성일: 2026-09-04
대상: ClawChat 수정 작업 (문서 임포트 스크립트는 범위 밖)
전제: `~/Desktop/research_graph`(지식 그래프: 가설·질문·판정·근거·교훈)와
`WORKSPACE_INDEX_ko.md`(worktree·artifact 계약)는 그대로 둔다.

## 0. 한 문장 목표

**지식 그래프는 "무엇을 아는가"를, ClawChat은 "지금 무엇을 하는가"를 맡는다.**
ClawChat 그래프에는 활성 갈래의 다음 실험만 올라오고, 판정은 원문 문서에만 적힌다.
두 그래프는 실험 식별자(`E65`, `Q24k`)와 작업 vault 폴더 하나로만 만난다.

## 1. 운용 규칙 (코드가 아니라 사용 규칙)

| 규칙 | 내용 |
|---|---|
| R1 갈래 = 프로젝트 | HOLD/MIXED로 다음 실험이 있는 갈래만 프로젝트로 만든다. `goal` = 핵심 질문 한 문장, `description` 첫 줄 = canonical 문서 절대경로 |
| R2 식별자 접두 | 작업 제목은 문서와 같은 id로 시작: `E65 …`, `Q24k …`. 태그 `exp/E65`, `branch/P0-R`, `repo/srp` |
| R3 깊이 3 | 프로젝트 → 질문/시리즈 → 실험(단계). 그 아래는 만들지 않는다. 상위 작업 7개 초과 시 프로젝트를 나눈다 |
| R4 depends_on | 선행 **결과**가 없으면 시작 못 할 때만. "관련"은 엣지로 만들지 않는다 |
| R5 완료 조건 | `completed` = 판정 문장이 원문 문서에 기록됨. 판정 내용(GO/HOLD/MIXED)은 ClawChat에 두지 않는다 |
| R6 실행 위치 | 갈래 프로젝트는 이 머신의 worktree 경로를 실행 호스트에 바인딩한다. 에이전트는 그 디렉터리에서만 쓴다 |
| R7 결과 봉인 | 리뷰 승인 = 결과가 `report` 아티팩트로 남음. 그 다음 사람이 판정을 문서에 옮기고 나서야 R5 |
| R8 작업 vault | Obsidian vault 경로 = `~/Desktop/research_graph/work/` (재생성 대상 아님). 갈래별 폴더 + `TODO.md`가 ClawChat 프로젝트와 1:1 |

## 2. ClawChat 수정 작업

우선순위 순. 각 항목은 독립 PR 크기.

### W1. 그래프 뷰: 프로젝트 스코프 + 단계 접기 기본값

- **목표**: 그래프를 열면 "프로젝트 하나, 질문/시리즈 노드, 접힌 단계, depends_on 엣지"만 보인다. 지식 그래프의 밀도를 흉내 내지 않는다.
- **수정**
  - `src/app/components/task-graph/TaskGraphPage.tsx`: 프로젝트 선택 드롭다운(`useProjectsQuery`), 선택 시 `todo.project_id`로 필터. URL `?project_id=`로 유지. 프로젝트 페이지의 "Plan" 탭에서 이 그래프로 진입하는 링크(`/tasks?view=graph&project_id=`).
  - `src/app/components/task-graph/TaskGraphView.tsx` + `taskGraphPersistence.ts`: 기본 접힘 = depth ≥ 2(단계). 접힘 상태는 이미 `collapsedIds`로 지원되므로 "처음 열 때 단계 노드를 접은 상태로 초기화"만 추가. 사용자가 펼친 상태는 기존 영속화 유지.
  - `taskGraphLayout.ts`: 변경 없음(레이아웃은 그대로).
- **수용 기준**: 프로젝트 A를 고르면 다른 프로젝트 노드가 사라진다. 단계가 있는 질문 노드는 접힘 표시(`▸ 3`)로 열리고, 클릭하면 펼쳐진다. 새로고침 후에도 프로젝트 선택이 유지된다.
- **테스트**: `TaskGraphPage` 렌더 테스트(프로젝트 필터, 기본 접힘), 기존 `taskGraphLayout` 테스트 통과.

### W2. 작업/프로젝트에서 "원본 문서 열기"

- **목표**: 판정은 문서에 있으므로, 작업 상세와 프로젝트 페이지에서 한 번에 원문으로 간다.
- **수정**
  - 규칙 R1의 "description 첫 줄 = 절대경로"를 코드가 읽는다. `src/app/utils/canonicalDoc.ts`(신규): description에서 `.md` 절대경로(`/home/...`, `~/...`) 또는 `obsidian://` URI를 추출.
  - `src/app/pages/TaskDetailPage.tsx`: "프로젝트 컨텍스트" 섹션 옆에 "원본 문서 열기" 버튼. 데스크톱은 `platformApi`로 파일 열기(없으면 경로 복사 + 토스트), 웹은 경로 복사.
  - `src/app/pages/ProjectWorkspacePage.tsx`: `ProjectIdentity` 아래 같은 버튼.
- **수용 기준**: description 첫 줄에 경로가 있으면 버튼이 보이고, 없으면 안 보인다. 데스크톱에서 클릭 시 Obsidian/기본 앱으로 열린다.
- **비고**: 별도 컬럼·마이그레이션 없음. 나중에 필요하면 `Project.canonical_doc_path`로 승격.

### W3. 프로젝트별 "에이전트 실행 규칙" (instruction preamble)

- **목표**: `WORKSPACE_INDEX_ko.md`의 계약(미커밋 결과 봉인 후 정리, `--force` 금지, artifact 위치)을 갈래 프로젝트마다 한 번 적어 두면 그 프로젝트의 모든 run instruction 앞에 붙는다.
- **수정**
  - 서버: `Project.execution_instructions: Text | None`(Alembic 마이그레이션 1개), `ProjectUpdate`/`ProjectResponse`에 노출, `npm run generate:api`, zod 미러(`src/app/types/schemas.ts`).
  - `server/services/agents/run_context_service.build_execution_instruction`: task의 프로젝트에 `execution_instructions`가 있으면 `[Project rules]` 블록으로 최상단에 삽입(기존 `[Recent conversation]`, `[Task instruction]` 앞).
  - 웹: `ProjectWorkspacePage`의 실행 설정 섹션에 textarea "에이전트 실행 규칙".
- **수용 기준**: 규칙을 저장한 프로젝트의 작업을 위임하면 `AgentRun.instruction_snapshot`이 `[Project rules]`로 시작한다. 빈 값이면 블록이 없다.
- **테스트**: `server/tests/test_run_context.py`에 프로젝트 규칙 삽입/미삽입 케이스.

### W4. 실험 작업 완료 게이트 (R5를 UI가 상기)

- **목표**: `exp/*` 태그가 있는 작업을 완료할 때 "판정을 문서에 적었는가"를 한 번 묻는다. 강제하지 않되, 건너뛰면 기록을 남긴다.
- **수정**
  - `src/app/pages/TaskDetailPage.tsx`, Kanban/AllTasks 완료 토글: 태그가 `exp/`로 시작하고 status가 `completed`로 바뀔 때 `ConfirmDialog` — "판정을 원문 문서에 기록했나요?" [기록함] [나중에]. "나중에"면 완료는 진행하되 `POST /api/task-comments`로 "판정 미기록" 코멘트를 남긴다(기존 task comments API 사용).
- **수용 기준**: 일반 작업은 다이얼로그 없음. `exp/E65` 태그 작업만 묻는다. Android는 이번 범위 밖(다음 항목).
- **테스트**: 다이얼로그 노출 조건 단위 테스트.

### W5. Obsidian 작업 vault 연동 점검 (코드 변경 최소)

- **목표**: R8대로 `research_graph/work/`를 vault로 지정했을 때 프로젝트 폴더/`TODO.md` 내보내기가 갈래 단위로 깔끔히 떨어진다.
- **확인/수정**
  - `server/services/vault/obsidian_export_service._get_file_path`: 프로젝트 소속 작업이 `source_id` 없이도 **프로젝트 제목 폴더**로 가는지 확인(현재 `project_name` 경로). 부모 todo 제목이 아니라 `Project.title`을 쓰도록 `todo_service.update_todo`/`create_todo`의 `project_name` 계산을 프로젝트 기준으로 정리(현재는 `parent.title`).
  - 내보내는 한 줄에 태그가 포함되는지(`_todo_to_md_line`이 tags를 붙임) 확인 → `#exp/E65`가 vault에 남아 `build_graph.py --work`가 읽을 수 있다.
  - Settings의 vault 경로 UI(`SettingsPage.tsx`)는 그대로 사용.
- **수용 기준**: 프로젝트 "P0-R …"의 작업 3개를 만들면 `work/P0-R …/TODO.md`에 3줄이 생기고 각 줄에 `#exp/…` 태그가 있다.
- **테스트**: `test_followup_vault_snapshot.py` 계열에 프로젝트 폴더 경로 케이스 추가.

### W6. Android 후속 (선택)

- `TasksScreen` 태그 표시(현재 미표시)와 W4의 완료 확인. 이번 지시서에서는 명세만 두고 구현은 다음 라운드.

## 3. 비목표

- 지식 그래프 노드(가설·판정·교훈)를 ClawChat에 임포트하지 않는다.
- ClawChat에서 판정 상태(GO/HOLD/MIXED)를 표시하지 않는다.
- `research_graph/build_graph.py`의 `--work` 프로필은 ClawChat 밖의 작업이며 이 지시서에 포함하지 않는다.

## 4. 검증 시나리오 (전부 끝났을 때)

1. 프로젝트 "P0-R Semantic referent binding" 생성, description 첫 줄에 canonical 경로, 실행 규칙 입력, 실행 호스트에 `~/Desktop/srp_e65` 바인딩.
2. 작업 스레드에서 "E65 …" 질문 작업 생성 → "계획 세워줘" → 단계 E65a/b 적용.
3. 그래프 뷰: 프로젝트 스코프로 열면 질문 노드 1개(접힘 ▸2), depends_on 없음.
4. E65a 위임 → run instruction이 `[Project rules]`로 시작 → 결과 리뷰 승인 → report 아티팩트.
5. E65a 완료 토글 → "판정 기록했나요?" → 기록함.
6. `work/P0-R …/TODO.md`에 `- [x] E65a … #exp/E65a` 줄 확인.

## 5. 순서와 크기

W1(중) → W3(중, 마이그레이션 1개) → W2(소) → W5(소) → W4(소) → W6(다음 라운드).
W1과 W3은 서로 독립이라 병렬 가능.
