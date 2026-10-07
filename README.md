# 우리 학교 학생자치회 홈페이지

4~6학년 13개 반과 전교임원이 함께 쓰는 학생자치회 웹앱이에요.
학생은 로그인 없이 주소(URL)만으로 들어오고, 데이터는 Cloudflare 서버(KV)에 저장돼서
여러 기기에서 함께 보고, 새로고침해도 그대로 남아 있어요.

## 폴더 구조

```
student-council-web/
├── public/                  ← 화면 (Cloudflare Pages가 그대로 보여 주는 파일)
│   ├── index.html           ← 첫 화면 틀
│   ├── style.css            ← 디자인
│   ├── api.js               ← 서버(/api)와 주고받는 부분
│   └── app.js               ← 화면과 기능 전체
├── functions/
│   └── api/
│       └── [[path]].js      ← 서버 API (/api/... 요청을 모두 처리)
├── .gitignore
└── README.md                ← 이 설명서
```

> `[[path]].js` 파일 이름의 대괄호 두 겹은 오타가 아니에요. Cloudflare가 "/api/ 아래 모든 주소"로 알아듣는 이름이에요. 그대로 두세요.

## 배포 방법 (처음 한 번)

### 1. GitHub에 올리기
1. GitHub에서 새 저장소(Repository)를 만들어요. 예: `student-council`
2. 이 폴더 안의 파일과 폴더를 **구조 그대로** 올려요.
   (웹에서 올릴 때는 "Add file → Upload files"에 `public`, `functions` 폴더와 `README.md`, `.gitignore`를 끌어다 놓으면 돼요.)

### 2. KV 저장소 만들기
1. https://dash.cloudflare.com 에 로그인
2. 왼쪽 메뉴 **Storage & Databases → KV** (또는 Workers & Pages → KV)
3. **Create a namespace** → 이름 예: `student-council-data` → 만들기

### 3. Pages 프로젝트 만들기
1. 왼쪽 메뉴 **Workers & Pages → Create → Pages → Connect to Git**
2. 1번에서 만든 GitHub 저장소 선택
3. 빌드 설정:
   - Framework preset: **None**
   - Build command: **(비워 둠)**
   - Build output directory: **`public`**
4. **Save and Deploy**

### 4. KV 연결과 비밀번호 넣기 (꼭 해야 해요)
Pages 프로젝트 → **Settings**에서:

| 어디 | 이름 | 값 |
|---|---|---|
| Bindings → Add → KV namespace | `KV` | 2번에서 만든 `student-council-data` |
| Variables and Secrets → Add (종류: **Secret**) | `ADMIN_PASSWORD` | 교사 비밀번호 (예: 길고 외우기 쉬운 문장) |
| Variables and Secrets → Add (종류: **Secret**) | `SESSION_SECRET` | 아무 긴 임의 문자열 (예: 40자 이상 무작위 글자) |

- Production(실제 사이트) 환경에 넣어요. Preview도 쓰려면 거기에도 똑같이 넣어요.
- 설정을 바꾼 뒤에는 **Deployments → 최신 배포 → Retry deployment**로 한 번 다시 배포해야 적용돼요.

### 5. 확인
- `https://프로젝트이름.pages.dev` 로 들어가 첫 화면이 보이면 성공이에요.
- 오른쪽 위 **교사 로그인** → `ADMIN_PASSWORD`로 로그인 → **자치회 관리** 탭에서
  반 비밀번호, 전교임원 이름·반·개인 비밀번호를 정해요.

## 비밀번호 정리

| 누구 | 어디서 정하나요 | 쓰는 곳 |
|---|---|---|
| 교사 | Cloudflare 환경변수 `ADMIN_PASSWORD` (코드에 없음) | 교사 화면 전체 |
| 각 반 (13개) | 교사 화면 → 자치회 관리 → 반 비밀번호 | 반 페이지 들어갈 때 |
| 전교임원 3명 | 교사 화면 → 자치회 관리 → 개인 비밀번호 | 전교임원 화면 로그인 |

- 반·전교임원 비밀번호는 서버에 암호화(해시)되어 저장되고, 화면이나 코드 어디에도 보이지 않아요.
- 비밀번호를 정하지 않은 반은 누구나 들어갈 수 있어요.
- 비밀번호를 바꾸면 그 반(그 임원)의 기존 로그인은 자동으로 풀려요.
- 로그인은 브라우저 탭을 닫거나 12시간이 지나면 풀려요.

## 누가 무엇을 쓸 수 있나요 (서버가 직접 확인해요)

| 내용 | 쓰기 |
|---|---|
| 선생님 안내, 전교회의 결과, 전교회의 출결, 자치회 임원, 공약 | 교사만 |
| 학급회의 결과, 월별 활동, 기지개 체조 체크 | 그 반 (반 비밀번호로 들어온 경우) + 교사 |
| 건의사항 | 누구나 새로 쓸 수 있고, 답변·상태 변경은 교사만 |
| 전교회의 안건, 전교임원 활동 기록 | 로그인한 전교임원 + 교사 |
| 선생님께 자료 보내기 | 로그인한 전교임원 (보낸 자료는 교사와 보낸 본인만 볼 수 있어요) |
| 글 삭제, 백업·복원 | 교사만 |

## 백업
교사 화면 → **백업·설정** 탭
- **서버 저장 / 서버 복원**: KV 안에 저장본 하나를 남기고 되돌려요. 마지막 저장 시각이 보여요.
- **파일 저장 / 파일 복원**: 모든 글과 첨부파일을 JSON 파일로 내려받고, 그 파일로 되돌려요.
  Claude에서 쓰던 예전 버전의 백업 파일도 복원할 수 있어요. 다만 예전 비밀번호는 옮겨지지 않으니 다시 정해 주세요.

## 알아 두면 좋은 점
- 화면은 15초마다 자동으로 새 글을 받아 와요. 글을 쓴 직후에는 바로 다시 받아 와요.
- Cloudflare 무료 요금제로 한 학교가 쓰기에 충분해요. 무료 한도는 KV 읽기 하루 10만 번, 쓰기 하루 1천 번이에요.
  모든 반이 하루에 쓰는 글과 체크가 1천 번을 넘으면 그날은 저장이 실패할 수 있어요. 그럴 때는 유료 요금제(월 5달러)를 쓰거나, 쓰는 횟수를 줄여 주세요.
- KV는 "마지막에 쓴 것이 남는" 방식이에요. 두 명이 같은 순간에 글을 올리면 하나가 잠깐 빠질 수 있어요.
  이 앱은 그런 글을 스스로 찾아서 몇 초 뒤 다시 보내요. 다만 글을 올리자마자 탭을 닫으면 다시 보내지 못할 수 있어요.
- 첨부파일은 하나에 8MB까지 보낼 수 있어요. 사진은 자동으로 줄여서 보내요.
- 전교회의 일정(9/30, 10/28, 11/25, 12/23)과 10월 기지개 체조 설정은 `public/app.js` 위쪽의
  `MEETING_PLAN`, `CHALLENGE` 부분에 있어요. 일정이 바뀌면 그 부분을 고쳐서 다시 올리면 돼요.

## 내 컴퓨터에서 미리 실행해 보기 (선택)
Node.js가 설치되어 있다면:
```
npx wrangler pages dev public --kv KV --binding ADMIN_PASSWORD=test1234 --binding SESSION_SECRET=local-dev-secret
```
그다음 브라우저에서 http://localhost:8788 을 열어요.
