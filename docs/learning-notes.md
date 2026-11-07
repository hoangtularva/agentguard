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
