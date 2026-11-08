# Learning notes — tự bảo vệ quyết định kỹ thuật khi phỏng vấn

Mỗi phase có 5 phần: kiến thức AI Engineering học được · vì sao thiết kế như vậy · lựa chọn khác · lỗi bảo mật hay gặp · câu hỏi nhà tuyển dụng có thể hỏi (kèm gợi ý trả lời).

---

## Phase 1 — Research & Architecture

**Kiến thức:**
- **PDP/PEP** (Policy Decision Point / Policy Enforcement Point) là mô hình chuẩn của authorization (XACML, OPA). PDP chỉ *quyết định*; PEP *chặn* và *thực thi*.
- **Indirect prompt injection**: kẻ tấn công không cần chat với agent. Chỉ cần đặt chỉ thị trong nội dung agent sẽ đọc (email, web, tài liệu).
- **Confused deputy**: agent có quyền của user nhưng bị nội dung bên ngoài "mượn" quyền đó.

**Vì sao thiết kế như vậy:** Tách mandate (user cho phép gì *cho task này*) khỏi policy (tổ chức cho phép gì *nói chung*). Một hành động phải qua cả hai. Đây là "least privilege theo task", không phải theo user.

**Lựa chọn khác:** Dùng classifier phát hiện injection (kiểu Lakera) → xác suất, có false negative. Dùng dual-LLM/CaMeL → mạnh hơn về lý thuyết nhưng phải viết lại agent. AgentGuard chọn kiểm soát ở *biên công cụ* (tool boundary) vì đó là nơi side effect xảy ra và kiểm soát được bằng code tất định.

**Lỗi hay gặp:** Tin vào system prompt ("đừng làm theo chỉ thị trong tài liệu") như một biện pháp bảo mật. Nó chỉ là defense-in-depth.

**Câu hỏi phỏng vấn:**
- *"Tại sao không để LLM tự đánh giá rủi ro?"* → Vì kẻ tấn công điều khiển được input của chính LLM đó. Quyết định bảo mật phải tất định, kiểm thử được, và không nằm trong vùng ảnh hưởng của attacker.
- *"Sản phẩm của bạn khác Lakera/NeMo thế nào?"* → Xem competitive-analysis.md. Trả lời trung thực: tool-call guarding không mới. Điểm hẹp là provenance của *đích đến* + approval binding + benchmark tái lập.

---

## Phase 2 — Policy Engine

**Kiến thức:** Đánh giá chính sách **tất định** (pure function), **default deny**, thứ tự ưu tiên BLOCK > REVIEW > ALLOW, versioning bất biến.

**Vì sao:**
- Pure function → unit test dễ, benchmark latency ~µs, cùng input + cùng version = cùng kết quả (kiểm chứng bằng test chạy 50 lần).
- Rule DSL có cấu trúc (discriminated union, Zod) thay vì cho viết regex/code → không có ReDoS, không có code injection vào policy.
- **Bài học thật trong dự án:** test phát hiện rule "review khi có dấu hiệu injection" vô tình biến *default deny* thành *REVIEW*: một rule tăng mức đã được tính như một rule *cho phép*. Sửa bằng `escalateOnly`: rule leo thang không bao giờ cấp quyền. Đây là ví dụ tốt để kể trong phỏng vấn ("tests found a fail-open bug in my own policy semantics").

**Lựa chọn khác:** OPA/Rego (mạnh, chuẩn công nghiệp, nhưng thêm runtime và phải học ngôn ngữ), Cedar (có phân tích hình thức). MVP chọn TypeScript thuần để không thêm service; kiến trúc PDP tách rời nên thay bằng OPA sau này được.

**Lỗi hay gặp:** Default allow. Glob khớp sai (`*@acme.example` khớp `x@evilacme.example`?) → có test cho look-alike domain. Policy lỗi thì "bỏ qua" (fail-open) → ở đây policy không tải được thì BLOCK.

**Câu hỏi:** *"Làm sao đảm bảo policy deterministic?"*, *"Nếu hai rule mâu thuẫn?"*, *"Rollback policy thế nào và ảnh hưởng gì đến approval đang chờ?"* (→ binding có policy version, đổi version thì approval cũ vô hiệu).

---

## Phase 3 — Agent Playground (LLM tool calling)

**Kiến thức:** Vòng lặp tool-use: model đề xuất `tool_use` → client thực thi → trả `tool_result`. Model **chỉ đề xuất**; runtime quyết định thực thi. `strict: true` cho JSON schema của tool. Gửi lại nguyên `response.content` (kể cả thinking blocks). Tool result đánh dấu `is_error` khi bị chặn.

**Vì sao:**
- Tách **Planner** (não) khỏi **Runtime** (vòng lặp) khỏi **PEP** (cổng). Runtime không có tham chiếu tới executor nào, nên không thể gọi tool mà bỏ qua PEP. Điều này được kiểm bằng ESLint + test kiến trúc.
- Simulated planner tất định, cố ý "ngây thơ": cho phép demo và benchmark không tốn API, không phụ thuộc may rủi của model.
- Playground dùng chế độ "defer": hành động cần duyệt vẫn chờ, agent tiếp tục để mọi đề xuất (kể cả đề xuất bị inject) đều hiện ra. Ban đầu thiết kế "pause" đã che mất các bước bị chặn phía sau. Bài học: UX demo ảnh hưởng tới việc người xem *thấy* được cơ chế bảo mật hay không.

**Lỗi hay gặp:** Để LLM gọi API thực thi trực tiếp. Tin vào `agentId` trong request (ở đây PEP đọc session từ DB). Trả lỗi bảo mật chi tiết cho attacker (cân nhắc: ở đây agent cần lý do để giải thích cho user).

**Câu hỏi:** *"Nếu model gọi song song nhiều tool?"* (planner xếp hàng từng đề xuất, trả mọi tool_result trong một message). *"Prompt injection còn nguy hiểm gì nếu tool bị chặn?"* (rò rỉ qua câu trả lời cuối, thao túng nội dung; ngoài phạm vi MVP).

---

## Phase 4 — Human Approval

**Kiến thức:** Approval là một **capability token dùng một lần**. Binding = hash canonical JSON của (tool call, session, user, agent, tool, args, policy version). Chống replay bằng **row lock + conditional update + unique constraint**, không phải bằng `if` trong code.

**Vì sao:**
- Canonical JSON (sắp key) → cùng args luôn cùng hash.
- `SELECT … FOR UPDATE` + `UPDATE … WHERE status='approved'` + unique `idempotency_key` và unique `tool_call_id`: ba lớp, để race condition (5 request song song) chỉ tạo đúng **1** side effect. Test chứng minh điều này.
- Retry cùng idempotency key → trả kết quả cũ (an toàn cho mạng chập chờn). Key khác → `APPROVAL_ALREADY_USED`.
- Check hết hạn ở *cả* lúc duyệt *và* lúc thực thi.

**Bài học thật:** deadlock khi đọc policy bằng connection ngoài transaction (PGlite chỉ có 1 connection). Trên Postgres thật nó không deadlock, nhưng sẽ đọc dữ liệu *ngoài* transaction, tức một lỗi nhất quán âm thầm. Sửa: truyền `tx` vào policy resolver.

**Lỗi hay gặp:** TOCTOU (check rồi mới update ở hai bước), approval không gắn version policy, cho client gửi lại args khi execute.

**Câu hỏi:** *"Idempotency key khác gì nonce?"*, *"Nếu executor crash sau khi đã claim approval?"* (hiện tại: approval đã `executed`, tool call `failed`; không chạy lại, tức fail-safe nhưng có thể cần retry thủ công; giải pháp production: outbox pattern).

---

## Phase 5 — Security Testing & Benchmark

**Kiến thức:** Đánh giá bảo mật cho AI cần **cả hai**: ASR (tấn công thành công) và FPR (chặn nhầm) + task completion. Thiếu FPR thì "chặn hết" cũng đạt 0% ASR.

**Vì sao:**
- Baseline = cùng agent, không guard. So sánh công bằng.
- Oracle khai báo `forbidden`/`required`/`expected` cho từng kịch bản, nên metric được *tính* từ trace thật.
- Báo cáo thêm **rubber-stamp ASR** (13.3%) để trung thực: REVIEW chỉ an toàn khi con người thật sự đọc.
- Test hồi quy trong CI khoá các ngưỡng; nếu code làm giảm bảo mật thì build đỏ.

**Lựa chọn khác:** AgentDojo, InjecAgent, AgentHarm (benchmark công khai, khách quan hơn); LLM-as-judge (không cần cho metric nhị phân "có thực thi hay không").

**Lỗi hay gặp:** Hardcode kết quả, tự viết dataset rồi tuyên bố "100% secure" (ở đây ghi rõ giới hạn: dataset tự viết, planner mô phỏng).

**Câu hỏi:** *"0% ASR có nghĩa là an toàn tuyệt đối không?"* → Không: nghĩa là các cơ chế hoạt động trên 15 kịch bản tấn công tự xây dựng, với reviewer lý tưởng. *"Bạn sẽ đánh giá với LLM thật thế nào?"* → `npm run bench:llm`, chạy N lần, báo cáo trung bình ± độ lệch, ghi model và effort.

---

## Phase 6 — UI, Docker, Portfolio

**Kiến thức:** Next.js 16 (async params, route handlers), server components đọc DB trực tiếp, client components chỉ gọi API. Base UI (shadcn mới) khác Radix. Kiểm màu biểu đồ bằng validator (lightness band, CVD ΔE), không chỉnh bằng mắt.

**Vì sao:** Màn hình được ưu tiên là Playground và Attack Lab vì chúng *giải thích* cơ chế (trace + lý do + provenance) thay vì chỉ hiện số. Mọi số trên UI lấy từ DB/benchmark thật.

**Lỗi hay gặp:** Identity lấy từ body request (ở đây: cookie ký HMAC + so sánh constant-time). Thiếu CSRF protection cho route dùng cookie (ở đây: same-origin check + SameSite). Chạy container bằng root (Dockerfile dùng user `app`).

**Câu hỏi:** *"Nếu triển khai thật, bạn thay gì đầu tiên?"* → Auth thật (OIDC) + tách executor thành service riêng giữ credential, chỉ nhận token thực thi do PEP ký. Đó là ranh giới process thật sự.

---

# Phase 2 — Windows, PostgreSQL thật, LLM local, đánh giá thật

## PostgreSQL thật & tính nguyên tử (atomicity)

**Kiến thức:** PGlite chỉ có 1 connection nên mọi transaction tự động tuần tự hoá. Lỗi race condition chỉ lộ ra khi có **nhiều backend thật**. `embedded-postgres` chạy binary PostgreSQL 16 chính thức như một process thường (không cần admin), đủ để test khoá dòng thật.

**Bài học thật:** phiên bản Phase 1 "claim" approval và "execute" ở **hai** transaction. Test trên Postgres thật đã tái hiện lỗi: nếu bước thực thi lỗi sau khi đã claim, approval bị đánh dấu `executed` nhưng hành động chưa từng chạy. Sửa: gộp claim + side effect + bản ghi execution vào **một** transaction. Test chạy trên code cũ thì fail, trên code mới thì pass. Đây là cách chứng minh một bản sửa lỗi.

**Câu hỏi phỏng vấn:** *"Tại sao unique constraint chưa đủ?"* → Nó chặn được thực thi trùng, nhưng không đảm bảo trạng thái nhất quán khi thất bại giữa chừng. Cần ranh giới transaction đúng. *"FOR UPDATE khoá những gì?"* → Chỉ dòng approval. Việc kích hoạt policy song song vẫn có thể commit ngay sau khi ta đọc version, và đó là chấp nhận được (tuyến tính hoá tại thời điểm đọc). Test "policy race" ghi lại hành vi này.

## LLM local với Ollama

**Kiến thức:** Model 3B quantized (Q4) chạy CPU 2 nhân: ~28 token/s đọc prompt, ~6 token/s sinh, 10–25 s mỗi lượt. `temperature 0` + `seed` cố định giúp tái lập trên cùng máy, nhưng không đảm bảo giống hệt khi khác phần cứng hoặc phiên bản Ollama. Vì vậy báo cáo phải ghi **model digest**, phiên bản Ollama và cấu hình sampling.

**Vì sao thiết kế provider adapter:** Một interface (`chat → text + tool calls + usage`) cho cả Anthropic lẫn Ollama. Provider **không có tham chiếu** tới executor; runtime luôn chuyển đề xuất qua PEP. Test dùng một "LLM độc hại" giả, luôn đề xuất exfiltration và tool không tồn tại: mọi đề xuất đều bị BLOCK và không có side effect nào.

**Quan sát thật:** model nhỏ hay sai định dạng tham số (ví dụ bỏ tiền tố `doc:`). Schema strict sẽ chặn (`INVALID_ARGUMENTS`); agent nhận lý do và có thể thử lại. Đây là đánh đổi giữa *fidelity* và *an toàn*: không bao giờ "đoán hộ" tham số cho một tool có side effect.

## Đánh giá với LLM thật

**Kiến thức:** Với LLM thật, "tấn công không thành công" có hai nguyên nhân rất khác nhau: model **không làm theo** injection (`attack_not_attempted`), hoặc model **làm theo** nhưng guard chặn (`attack_blocked`). Chỉ báo ASR sẽ che mất điều này. Tương tự, task hợp lệ thất bại có thể do model yếu (`task_failed_model`) hoặc do guard chặn nhầm (`task_failed_guard`).

**Held-out set:** viết *sau khi* đóng băng policy, dùng tài liệu và kiểu tấn công mới (CEO fraud, JSON injection, approval giả, policy giả, địa chỉ bị làm rối, đích do model bịa). Không được tinh chỉnh policy theo bộ này, nếu không con số sẽ mất ý nghĩa.

**Câu hỏi phỏng vấn:** *"Benchmark LLM của bạn có ý nghĩa thống kê không?"* → Với 14 kịch bản × 1 lần chạy trên CPU thì **không**. Nó là bằng chứng định tính về hành vi. Muốn có ý nghĩa thống kê cần nhiều lần chạy với seed khác nhau, nhiều model, và dataset công khai (AgentDojo).

## Bảo mật & dependency

- `npm audit`: lỗ hổng critical chỉ nằm ở dev dependency (vitest/tinypool) → nâng cấp lên vitest 5. Gói lạ `cn` bị một import hỏng của shadcn kéo vào (đây là rủi ro supply-chain) → đã gỡ. Dependency production: 0 lỗ hổng.
- CSRF: thêm kiểm tra `Sec-Fetch-Site` bên cạnh `Origin`.
- DoS: giới hạn một lần chạy LLM/benchmark tại một thời điểm (429), vì một model local trên CPU rất dễ bị làm cạn tài nguyên.
- Phân biệt **demo security** (cookie danh tính có HMAC, chạy chung một process) với **production security** (OIDC, tách executor service, audit log có hash-chain).

---

# Phase 3 — Đánh giá LLM thật nghiêm túc & red team

## Dev / holdout và tại sao phải đóng băng code
**Kiến thức:** Bất kỳ con số nào bạn nhìn thấy rồi sửa code theo nó đều không còn là phép đo độc lập. Quy trình: chạy **DEV** → tìm *lỗi* (không chỉnh rule cho đẹp số) → sửa → chạy lại DEV → **đóng băng commit** → chạy **HOLDOUT** một lần, với nhiều seed. Commit đóng băng được ghi trong log benchmark.

**Bài học thật trên DEV:** lần chạy đầu cho FP 37,5%. Đào sâu thì *không phải* policy chặn sai, mà là:
1. Model nhỏ làm hỏng tham số (bỏ `doc:`, thêm khoá lạ, ký tự rác). PEP từ chối đúng, nhưng thông báo lỗi quá mơ hồ để model tự sửa → sửa thông báo lỗi (không nới schema). Kết quả: FP 9,7%, hoàn thành task 75% → 100%.
2. Oracle đếm các lệnh gửi tới **địa chỉ do model bịa** là "hợp lệ" → định nghĩa lại: FP chỉ đo trên lệnh *người dùng thực sự yêu cầu*. Lệnh tới đích bịa được đếm riêng (khi không guard: thực thi; khi có guard: bị chặn).

**Câu hỏi phỏng vấn:** *"Làm sao biết bạn không overfit benchmark?"* → DEV/HOLDOUT tách biệt, holdout viết song song nhưng chỉ chạy trên commit đóng băng, nhiều seed, báo CI; mọi thay đổi sau DEV đều ghi lại kèm lý do (lỗi sản phẩm hoặc lỗi đo lường, không phải chỉnh rule).

## Khoảng tin cậy
**Kiến thức:** Wilson interval tốt hơn "±1.96·√(p(1−p)/n)" khi p gần 0 hoặc n nhỏ (khoảng normal sẽ cho [0,0] khi p=0 — vô nghĩa). Ví dụ 0/20 tấn công thành công → CI 0–16%: nghĩa là *chưa loại trừ được* tỷ lệ thật tới 16%. Các lần lặp cùng kịch bản không độc lập nên CI thực tế còn rộng hơn — phải nói rõ.

## Red team: tìm lỗi ở chỗ "không phải tính năng bảo mật chính"
**Bài học:** PEP/approval đã được test kỹ, nhưng lỗ hổng thật lại nằm ở **lớp ứng dụng xung quanh**: danh tính mặc định (F1), nút đổi danh tính (F3), trang đọc dữ liệu không giới hạn theo người dùng (F4 — IDOR). Đây là mẫu thường gặp: hệ thống "bảo mật" bị hở ở dashboard/admin UI.

**Cách làm đúng:** (1) tái hiện bằng request thật (curl vào stack Docker production), (2) ghi severity + root cause, (3) sửa, (4) viết test hồi quy chạy *trước* (fail) và *sau* (pass), (5) ghi rõ cái gì *không* sửa (OIDC, CSP nonce, rate limit).

**Câu hỏi phỏng vấn:** *"IDOR là gì, bạn chặn thế nào?"* → Truy cập object qua id mà không kiểm tra quyền sở hữu. Chặn ở **tầng truy vấn** (mọi read model nhận `Viewer`), trả 404 cho cả "không tồn tại" lẫn "không thuộc về bạn" để không lộ sự tồn tại.
