# opencode 플러그인 API 레퍼런스

opencode 공식 문서에서 추출한 플러그인 개발 관련 API 정리.

## 플러그인 구조

```typescript
// .opencode/plugins/my-plugin.ts
import { definePlugin } from "@opencode/plugin";

export default definePlugin({
  name: "my-plugin",
  setup(app) {
    // hook 등록, 커스텀 도구 등록 등
  }
});
```

## 설치 위치
- `.opencode/plugins/` 디렉토리에 `.ts` 또는 `.js` 파일 배치 → 자동 로드
- npm 패키지로 배포 가능

## 의존성
- `.opencode/package.json`에 선언하면 opencode가 `bun install`로 자동 설치

## 사용 가능한 Hook 이벤트

| 이벤트 | 설명 | args |
|--------|------|------|
| `tool.execute.before` | 도구 실행 직전 | `{ tool, args, output }` — output.args 수정 가능 |
| `tool.execute.after` | 도구 실행 직후 | `{ tool, args, result }` |
| `session.create` | 세션 생성 시 | `{ session }` |
| `session.delete` | 세션 삭제 시 | `{ session }` |
| `session.update` | 세션 업데이트 시 | `{ session }` |
| `shell.env` | 셸 환경변수 설정 | `{ env }` |
| `tui.command.execute` | TUI 명령어 실행 시 | `{ command }` |
| `experimental.session.compacting` | 세션 압축 시 | `{ session }` |

## Hook 사용법

```typescript
app.hook("tool.execute.before", async (event) => {
  // event.tool — 도구 이름 (string)
  // event.args — 도구에 전달될 인자 (object, 읽기 전용)
  // event.output.args — 수정 가능한 인자 (이것을 변경하면 실제 도구에 전달됨)
});
```

## Config 접근

```typescript
// sdk를 통해 현재 설정에 접근
// sdk.config.providers — 설정된 provider 목록
// sdk.config.model — 현재 모델 설정
```

## 커스텀 도구

```typescript
app.tool("my-tool", {
  description: "설명",
  parameters: { /* JSON Schema */ },
  execute: async (args) => { /* 구현 */ }
});
```

## 주의사항
- `beforeAgentCall` 훅은 존재하지 않음
- `tui.command.execute`는 기존 명령어 실행 이벤트를 리스닝하는 것이지, 새 명령어를 등록하는 API가 아닐 수 있음 → Go 소스 확인 필요
- hook에서 args를 수정할 때 `event.output.args`를 사용해야 함 (event.args 직접 수정 불가)
