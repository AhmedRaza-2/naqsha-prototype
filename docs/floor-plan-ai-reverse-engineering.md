# floor-plan.ai: complete reverse-engineering reference

Audience: a coding agent that will implement a similar system. Every section says what was observed, and where something is inferred it is marked.
Target: https://floor-plan.ai/floor-plan-generator (plus every other tool reachable from it).
Method: `rea` v6.4.0 against the live page (target listing, passive page inspection), then static analysis of all **568 JavaScript chunks** the site ships (16 MB, Nuxt 3 production build, minified but not obfuscated). Date: 2026-10-13.

## 0. Confidence legend and honest limits

| Tag | Meaning |
|---|---|
| **[code]** | Read directly from the shipped client code. Exact. |
| **[inferred]** | A reasonable conclusion from the code. Could be wrong. |
| **[unknown]** | Not determinable from the browser. Do not assume. |

What is **[unknown]** and cannot be found from the client: server code, server-side system prompts, GPU hardware, training data, exact vendors behind each model ID, and response bodies (no generation was recorded during the live capture; the response shapes below are read from the code that consumes them).

Nothing here was obtained by calling their API or bypassing anything. Do not copy their code, assets, prompts verbatim into a commercial product, or call their endpoints: reimplement the *architecture*.

---

## 1. Executive summary

1. **It is not one model. It is a thin web app that orchestrates third-party hosted models behind a single API gateway** (`https://api.floor-plan.ai/api`). [code]
2. **"Floor plan generator" = an image-generation model drawing a picture.** The browser builds a text prompt from a form (rooms, sizes, style), a server runs an image model, and the result is a PNG URL. There is no geometry in the result. [code]
3. **"Convert to 3D" (Floor Plan to 3D / Visualizer) is image-to-image rendering**, using the same image models with a 3D-render prompt. It produces a rendered picture, not a mesh. [code]
4. **A separate "AI 3D Generator" does produce real meshes (GLB)** using Tencent Hunyuan3D (versions 3.0 and 3.1). It is *not* what the floor-plan page links to by default. [code]
5. **The editable plan tool ("Floor Plan Creator") is a different pipeline:** an LLM agent returns a **structured scene JSON** (walls, doors, windows, furniture, labels with coordinates), the browser draws it as editable SVG, and DXF is written **in the browser**. This is the part most relevant to a deep-learning project because the output is structured. [code]
6. **Raster to DXF/DWG** goes to the server, which uses **vectorizer.ai** for raster-to-vector conversion. [code: history filter `input_model: ["vectorizer.ai"]`]
7. **All inference runs on remote servers. Nothing runs on the user's computer** except UI, SVG editing, the DXF writer and the Three.js GLB viewer. No ONNX, TensorFlow.js or OpenCV is shipped. [code]
8. **Training data: they do not appear to train any model.** Nothing in the bundle suggests a custom model; every model ID is a third-party one. Whatever those models were trained on is not disclosed here. [inferred]

---

## 2. Architecture

```
 BROWSER (Nuxt 3 / Vue 3 SPA+SSR on floor-plan.ai)
 ├─ UI: tabs Room | House | Custom, style picker, model picker, ratio, units
 ├─ Prompt builder (client-side string templates)  ── sections 8, 9
 ├─ Upload: SHA-256 -> POST /user/v1/upload-sign -> PUT to presigned URL -> cdn.floor-plan.ai
 ├─ Signed requests: AES+RSA query signature on every call            ── section 7
 ├─ Poller: GET status every 3-5 s, up to 100 times
 ├─ SVG scene editor (Floor Plan Creator) + client-side DXF writer
 ├─ Three.js r183 + GLTFLoader + OrbitControls (3D model viewer)
 └─ pdf.js, html2canvas, jsPDF (export / rasterize)
            │  HTTPS (JSON; SSE for LLM streams)
            ▼
 API GATEWAY  https://api.floor-plan.ai/api         (auth, credits, moderation, task queue, history)
 ├─ image tasks   ──► Nano Banana (Basic), gpt-image-2 (Advanced), Nano Banana Pro (Pro)   [model IDs in code; vendors inferred]
 ├─ 3D tasks      ──► Tencent Hunyuan3D 3.1 / 3.0 / rapid  -> GLB
 ├─ CAD tasks     ──► vectorizer.ai (raster -> vector) -> DXF / DWG
 ├─ LLM tasks     ──► "gemini-3.1-pro-preview" (prompt rewrite)
 │                    GPT-6-Astra / GPT-5.6-Terra / GPT-5.6-Sol / DeepSeek-V4.1-Flash / DeepSeek-V4-Pro (floor-plan agent)
 ├─ object store  ──► CDN  cdn.floor-plan.ai (uploads and outputs)
 └─ payments      ──► Clink Pay (/api/clink/v1/pay)
```

Async pattern for every heavy job: `POST .../create` returns `{code:200, data:{task_id}}`, then the client polls a `status`/`check` endpoint until `msg === "success"` and a result URL is present. Record status in lists: `0` = completed, `1` = processing, `2` = failed.

---

## 3. Site routes (pages) and what each does

| Route | Purpose | Backing pipeline |
|---|---|---|
| `/floor-plan-generator` | **Main target.** Text/form to 2D plan image | Image generation (section 5.1) |
| `/floor-plan-creator` | Manual drawing plus **AI Floor Plan agent** | SVG editor + `/v1/floor-plan-json` (5.2) |
| `/floor-plan-editor?img_url=` | Upload/edit an existing plan, add a floor | Image models + agent |
| `/floor-plan-designer` | Designer variant of the creator (`platform: floor_plan_designer`) | `fp-design` save/load |
| `/floor-plan-to-3d?img_url=` | **"Convert to 3D"**: plan image to a rendered 3D-looking image | Image models, platform `floor-plan-visualizer` (5.3) |
| `/ai-3d-generator` | Text/image/sketch to **GLB mesh** | Hunyuan3D (5.4) |
| `/converter/dxf-converter` | PNG/JPG to DXF/DWG | `/v1/image-to-cad`, vectorizer.ai (5.5) |
| `/ai-workspace` | Chat-style image agent (history per session) | `/v1/chat-agent-history` + image models |
| `/historys`, `/uploads`, `/templates`, `/ideas` | History, uploads, templates, inspiration | list endpoints |
| `/converter/cm-to-feet`, `cm-to-inches`, `inches-to-feet` | Unit converters | client-side |
| Render tools | interior-design-ai, exterior-design-ai, AI-Landscape-Design, garden-design-ai, virtual-staging-ai, sketch-to-image | image models, different prompt templates |
| Plan variants | electrical-plan, lighting-plan, plumbing-plan | same generator, different `platform` tag |
| Video tools | image-to-video ("animate your floor plan"), transitions, drone | `/v1/image-to-video` |
| `/pricing`, `/business`, `/affiliate`, `/help` | Commerce and marketing | Clink Pay |

Landing/SEO pages are mostly prerendered (`_payload.json` per route).

---

## 4. Complete API reference

Base: `https://api.floor-plan.ai/api`. Every request also carries signed query params (section 7).

### 4.1 Auth, user, upload

| Method | Path | Notes |
|---|---|---|
| POST | `/user/api/login`, `/user/api/google/login`, `/user/api/logout` | email or Google; returns a token stored as `loginUserToken` |
| GET/POST | `/user/api/get/info`, `/user/v1/credit` | profile and credit balance |
| POST | `/api/sso/jwt`, `/v1/sso/get-token` | single sign-on between sub-products |
| POST | `/user/v1/upload-sign` | body `{filename, hash}` (SHA-256). Returns `{code:200, data:{url, object_name}}`, a presigned PUT URL |
| PUT | *presigned URL* | raw file body with `content-type`. Client then rewrites the bucket host to `cdn.floor-plan.ai` (strips query) and passes that URL as `images[]` |
| POST | `/api/clink/v1/pay` | checkout with `plan_id, user_id, email, transaction_id, pay_type, redirect_url` |

Auth headers: logged in = `Xy-Access-Token: <token>` (v1/v2/v3 image routes) or `Authorization: Bearer <token>` (model-3d, image-to-cad, agent routes). Guests use `/free/` routes with a `user_id` in the body/query. [code]

### 4.2 Image generation (the floor-plan generator)

| Tier (UI) | Model ID | Create | Status | Credits | Notes |
|---|---|---|---|---|---|
| Basic | `nano-banana` | `POST /v2/home-design/create` (guest: `POST /v2/free/home-design/create`) | `GET /v2/home-design/status?task_id=` (guest: `/v2/free/home-design/status?task_id=&user_id=`) | **1** | resolution fixed 1K in the agent |
| Advanced (internal `Standard`) | `gpt-image-2` | `POST /v1/home-design-2/create` | `GET /v1/home-design-2/status?task_id=` | **3** | extra body: `quality` (low/medium/high), `moderation:"auto"`, `background:"auto"`; ratios only `1:1, 2:3, 3:2` |
| Pro | `nano-banana-pro` | `POST /v3/home-design-pro/create` | `GET /v2/home-design-pro/status?task_id=` | **4** (+2 for 4K in the agent) | `resolution: "2K"` |

Body:
```jsonc
{
  "payload": "<JSON string of structured fields, see 4.2.1>",   // OR "prompt": "<free text>"
  "images":  ["https://cdn.floor-plan.ai/....png"],             // reference images, [] if none
  "output_format": "png",
  "aspect_ratio": "16:9",                                        // 16:9 4:3 1:1 3:4 9:16 21:9 2:3 3:2 auto
  "platform": "Floor-Plan-Generator",                            // tool tag, see below
  "resolution": "2K",                                            // Pro only
  "user_id": "<guest id>"                                        // guest routes only
}
```
`platform` tag per tab: Custom = `Floor-Plan-Generator`, Room = `floorPlanGenerator`, House = `floor-plan-creator`. The registry in the AI Workspace maps the three tiers to the model IDs above explicitly: `[{id:"nano-banana",label:"Basic",base:"/v2/home-design",creditsPerImage:1},{id:"gpt-image-2",label:"Advanced",base:"/v1/home-design-2",creditsPerImage:3},{id:"nano-banana-pro",label:"Pro",base:"/v3/home-design-pro",creditsPerImage:4}]`. [code]

Ratio rules [code]: Advanced coerces any ratio to `1:1`, `2:3` or `3:2` (anything unknown becomes `3:2`); Basic/Pro coerce `9:21` to `16:9`; default `16:9`.

Guests can only use Basic. Selecting Advanced or Pro while logged out opens the login modal.

Response: `{code:200, data:{task_id}}`. Error `code` values handled: `401` insufficient credits, `40004` credits used up, `40005` task creation failed, `40105` prompt violates content policy, `50104` text moderation busy.

Polling: generator = every **5 s, up to 100 times**; visualizer = every **3 s, up to 100**. Success when `code===200` and `msg==="success"` and an image URL is found in `data.generate_url` or `data.images[0]`.

#### 4.2.1 `payload` JSON by tab

Custom tab (free text):
```json
{ "style": "technical", "unit": "ft/in", "dimensions": "Show", "plan_language": "English",
  "door_swing": "<optional>", "user_input": "<prompt, optionally AI-enhanced>" }
```
Room tab, mode `generate` (the server expands this; the client also sends the long prompt in analytics):
```json
{ "rooms": "\n\n- bedroom1: [3x4m2]\n- kitchen1: [..]\n\n", "style": "technical", "extra_details": "<notes>" }
```
Room tab other modes: `edit` -> `{ "edit_requirements": "..." }` plus an uploaded image; `image-to-design` -> a fixed redesign prompt (section 8.3).
House tab (`summary`):
```json
{ "bedroom": 2, "living_room": 1, "bathroom": 1, "kitchen": "open", "floors_count": 1,
  "gross_area": "120 sqm", "style": "technical", "extra_details": "" }
```
Style labels sent: `technical`, `3d-isometric`, `Colored-2D`, `Blueprint`, `Hand-Drawn`, `Anime`, `Watercolor`, `Marker-pen`, `Collage`, `Realistic`.

### 4.3 Prompt rewrite ("AI Enhance")

`POST /crun/v1/img-to-json/create`, header `accept: text/event-stream`, body:
```json
{ "model": "gemini-3.1-pro-preview", "platform": "prompt_gemini", "temperature": 0, "prompt": "<user prompt>" }
```
Server streams SSE (`event: message` chunks with `data.prompt`, finally `event: done`). The client concatenates up to 5000 characters and shows original vs optimized in a dialog. The system instruction that does the rewriting is server-side [unknown]. Disabled for users whose country code is IN (client-side region check). Daily quota: error text "Today's free prompt optimizations are used up". The toggle state is cached in `localStorage` (`floor_plan_generator_prompt_enhancement_state`) and re-armed each day.

### 4.4 AI Floor Plan agent (structured output)

Base `${api}/v1/floor-plan-json`. Authenticated only.

| Method | Path | Purpose |
|---|---|---|
| POST | `/chat` | start a conversation; body `{message, title?, model?, reasoning_effort?, img_url?}` |
| POST | `/chat/{conversationId}` | next turn |
| GET | `/jobs/{jobId}` and `/jobs/{jobId}/progress` | poll a job |
| GET | `/jobs/{jobId}/events?since=n` | **SSE** stream; event types `message`, `completed`, `failed` |
| DELETE | `/jobs/{jobId}` | cancel |
| GET | `/conversations?offset&limit`, `/conversations/{id}/history?offset&limit` | history |

Model dropdown (value -> label): `gpt-6-astra` GPT-6-Astra (HOT), `fast` GPT-5.6-Terra, `high` GPT-5.6-Sol, `deep-fast` DeepSeek-V4.1-Flash (NEW), `deep-high` DeepSeek-V4-Pro. Default `reasoning_effort` = `"high"`. When a plan image is attached (`img_url`), the DeepSeek "deep-high" model is swapped for another because it is text-only [inferred from `Hs()` logic]. The job status values are `queued`, `running`, `completed`, `failed`, `cancelled`. The backend appears to run an agent runner: error codes include `opencode_failed` and the message "the GPT request failed" [inferred].

On `completed`, `result` is the scene JSON of section 6.1, which the page applies to the canvas (`apply-plan`). The UI streams a "reasoning" text while it works (a sample is embedded in the bundle as a demo).

### 4.5 3D mesh generation

Base `${api}/v1/model-3d`, Bearer auth.
```
POST   /create                      -> {code:200, data:{task_id}}
GET    /check?task_id=              -> {code:200, msg:"processing"|"success", data:{generate_url, thumbnail_url}}
POST   /list    {page,page_count,input_model[],platform[],status}
DELETE /delete/{id}
```
Create body [code]:
```jsonc
{
  "model": "3.1",                    // "3.1" for Basic, "3.0" for Pro
  "platform": "hunyuan_model_3d",
  "enable_pbr": false,               // physically based materials
  "face_count": 0,                   // 0 = auto; otherwise target polygon count
  "generate_type": "Normal",         // "Normal" | "LowPoly" (Pro only) | "Geometry" (untextured)
  "result_format": "GLB",
  "title": "<max 120 chars>",
  "prompt": "<text mode>",           // text -> 3D
  "image_url": "<cdn url>",          // image or sketch -> 3D
  "multi_view_images": [ { "ViewType": "back", "ViewImageUrl": "<url>" } ]   // optional extra views
}
```
Allowed `ViewType`: `left, right, back, top, bottom, left_front, right_front` (model 3.0 skips `top, bottom, left_front, right_front`). Input modes: `text`, `image`, `sketch`. History filter shows the three model IDs in use: `hunyuan/3.1`, `hunyuan/3.0`, `hunyuan/rapid`. Credit cost function [code]: for Hunyuan 3.0/3.1, `Normal` = 8, `Geometry` = 6, otherwise (LowPoly) = 10; for other model strings 10 with PBR, 6 without. Polling: every 5 s up to 100. The GLB is loaded with the Three.js `GLTFLoader` in an `OrbitControls` viewer.

### 4.6 Raster to CAD

Base `${api}/v1/image-to-cad`, Bearer auth.
```
POST /create  { image_url, task_type: 1|3, platform: "vectorizer"|"image-to-dxf"|"image-to-dwg",
                no_text_recognition: 0|1, img_id? }
GET  /status?taskid=&task_id=
```
Response success is `code === 1` or `200`; the client normalizes `taskid`/`task_id`/`taskId`. Result fields tried in order: `dxf_url, generate_url, image_url, dwg_url, cad_url, file_url, url`; DWG is `generate_dwg_url` / `dwg_url`. History filter `input_model: ["vectorizer.ai"]` and `/v1/vectorizer/{list,delete}` show the backend is the vectorizer.ai service [code].

### 4.7 Persistence and misc

| Path | Use |
|---|---|
| `POST /v1/home-design/list`, `/v1/free/home-design/list`, `DELETE /v1/home-design/delete/{id}` | generation history (`page, page_count, platform[], user_id, status`) |
| `POST /v1/fp-design/create` `{image_url, origin_name, json_url, platform}`, `/list`, `/update/{id}`, `/delete/{id}` | saved Creator designs: a preview image plus the scene JSON file |
| `/v1/upload-history/list`, `/v1/favorite`, `/v1/task-trash/*` | uploads, favorites, trash/restore |
| `/v1/billing-info/list`, `/invoice` | billing |
| `/v1/image-to-video/{create,check,list,delete}` | animate a plan |
| `/api/widget/*` | feedback widget |

---

## 5. What happens on each click

### 5.1 Floor Plan Generator: "Generate" (the main flow)

1. User picks a tab (Room / House / Custom), style (default `technical`), tier (default Basic), ratio (default `16:9`), units, and presses **Generate (1 credit)**.
2. Guard checks: prompt not empty; if logged out and tier is Advanced/Pro -> login modal; if logged in and `credits < cost(tier)` (Basic 1, Advanced 3, Pro 4) -> "Insufficient credits"; guests need a remaining free quota.
3. **Custom tab only:** if AI Enhance is on and the user is not in India, show the optimizer dialog; stream the rewritten prompt (section 4.3); the user picks original or optimized.
4. Reference image (optional): SHA-256 the file, `upload-sign`, `PUT`, rewrite host to the CDN, push the URL into `images[]`.
5. Build the `payload` JSON for the tab (4.2.1) and select the endpoint by tier (4.2). Sign the query (section 7). `POST create`.
6. Response `task_id` -> show a loading state, refresh history, and start polling `status` every 5 s up to 100 times.
7. On `success` -> read `generate_url` -> show the image; save to history and to `localStorage` key `floor-plan-recent-projects`.
8. Result actions: Download (PNG), **Edit Image** -> `/floor-plan-editor?img_url=`, **Convert to DXF** -> `/converter/dxf-converter?img_url=`, **Convert to 3D** -> `/floor-plan-to-3d?img_url=`, animate.

The generated image is whatever the image model draws from the prompt (section 8.1). There is no layout solver, no rule checking, and no coordinate output. Dimensions in the picture are the model's best guess. [code + inferred]

### 5.2 Floor Plan Creator: AI Floor Plan agent

1. User types a request (e.g. "3-bedroom family home") or attaches a plan image, chooses a model and reasoning effort.
2. `POST /v1/floor-plan-json/chat` -> `jobId`. The client opens the SSE stream `/jobs/{id}/events`, falling back to polling `/jobs/{id}/progress` if the stream breaks. UI states: `queued` -> `generating` -> `saving` -> `completed`.
3. The completed job's `result` is a scene JSON (6.1). The page applies it to the canvas. The user can then move walls, drag furniture, edit labels, undo, and snap.
4. Save -> `POST /v1/fp-design/create` with a preview image and the scene JSON file URL.
5. Export: **DXF is written in the browser** by an embedded DXF writer library (class API: `addLine`, `addLWPolyline`, `addRectangle`, `addAlignedDim`, `addLinearDim`, `addRadialDim`, ..., entity handles, `AcDb*` subclass markers; its API matches the open-source `@tarikjabiri/dxf` package [inferred]). No server round trip.

### 5.3 "Convert to 3D" (Floor Plan Visualizer)

1. Entered from a result (`?img_url=`) or by uploading a plan (JPG/PNG/PDF/SVG, max 50 MB).
2. Controls: view mode `full-plan` or `single-room`; style (Scandinavian, Modern, Minimalist, Industrial, Bohemian, Contemporary, ...); room type; extra details; tier Basic/Advanced(default)/Pro.
3. In `single-room` mode the user places a camera marker `{x, y, angle}` on the plan; the browser rasterizes the plan with that marker burned in (`exportCompositeFile()`) and uploads it.
4. Request: the **same image endpoints as 4.2** with
```json
{ "payload": "{\"view_angle\":\"full-plan\"|\"single-room\",\"style\":\"Scandinavian\",\"extra_details\":\"\"}",
  "images": ["<plan image url>"], "output_format": "png", "aspect_ratio": "auto",
  "platform": "floor-plan-visualizer" }
```
5. Poll every 3 s up to 100 times. The result is a **raster render**, not a 3D model. [code]

### 5.4 AI 3D Generator (real mesh)

User supplies text, an image, or a sketch -> optionally extra views -> chooses Basic (Hunyuan 3.1) or Pro (3.0), PBR on/off, face count, generate type -> client checks credits -> `POST /v1/model-3d/create` (4.5) -> poll `/check` every 5 s -> `generate_url` is a `.glb` -> Three.js `GLTFLoader` renders it with `OrbitControls`; download as GLB.

### 5.5 Convert to DXF / DWG

Source image URL -> `POST /v1/image-to-cad/create` with `platform` `vectorizer` (PNG to DXF), `image-to-dxf` or `image-to-dwg` -> poll `/status` -> read `dxf_url` / `dwg_url`. The vector tracing is done server-side by vectorizer.ai. [code]

### 5.6 Credits and billing

Credits are a per-account integer (`/user/v1/credit`), decremented server-side on create. The client checks `credits >= cost` first. Costs: Basic 1, Advanced 3, Pro 4, +2 for 4K (agent); 3D 6-10 depending on options. "Get Free Credits" and a guest free tier exist. Checkout uses Clink Pay. [code]

---

## 6. Data schemas

### 6.1 Scene JSON (structured floor plan from the agent)

```jsonc
{
  "version": 1,
  "exportedAt": "2026-09-09T00:00:00.000Z",
  "canvasSize": { "w": 1200, "h": 800 },
  "items": [
    // walls: segments, not polygons
    { "toolId": "architectural-wall-horizontal", "kind": "architectural",
      "x": 47, "y": 47.5, "width": 200, "height": 5, "rotation": 0, "scaleX": 0.43, "scaleY": 2.4,
      "assetId": "architectural-wall-horizontal", "planWallType": "segment-h", "strokeWidth": 12 },
    { "toolId": "architectural-wall-vertical", "planWallType": "segment-v", "...": "..." },
    // openings and doors
    { "toolId": "architectural-opening-line", "assetSection": "windows", "strokeWidth": 0.7, "...": "..." },
    { "toolId": "architectural-door-swing-right", "assetSection": "doors", "rotation": 90, "...": "..." },
    // furniture and fixtures
    { "toolId": "architectural-bed-double-top", "assetSection": "furniture", "width": 165, "height": 155, "...": "..." },
    // labels
    { "toolId": "text-label", "kind": "text", "text": "OVERALL HOME 14.0 m × 10.0 m", "fontSize": 14,
      "fontFamily": "Arial, sans-serif", "align": "center", "fill": "#334155", "textBox": true, "...": "..." }
  ]
}
```
Observed in the shipped 89-item sample (a 3-bedroom family home, 14.0 m by 10.0 m): 18 horizontal walls, 16 vertical walls, 9 opening lines, 10 door swings (left/right), 13 text labels, 23 furniture/fixture items. `kind` is `architectural` or `text`. Asset IDs seen: `architectural-` + {`wall-horizontal`, `wall-vertical`, `opening-line`, `door-swing-left`, `door-swing-right`, `bed-single-top`, `bed-double-top`, `dresser-mirror`, `sofa-three-seat`, `armchair`, `table-rectangular`, `table-rect-6-seat`, `tv-media-unit`, `counter-l-shaped`, `sink-double`, `sink-single-top`, `sink-vanity-top`, `kitchen-island-cooktop`, `shower-square`, `toilet-top`, `washer-top`, `plant-top`}.

Notes: walls are **axis-aligned segments** (horizontal or vertical only); every item is an axis-aligned rectangle (`x, y, width, height`) with `rotation`, `scaleX`, `scaleY`; one canvas unit is roughly 1 cm at the scale the labels use (the demo labels a 14.0 m house on a 1200 px canvas, so units are not literal). The LLM places items by emitting numbers directly. The embedded demo reasoning text shows the model checking door swings, furniture overlap and clearances by hand, which means **there is no geometric solver in the loop** [inferred].

### 6.2 Record statuses and ids

`status`: `0` completed, `1` processing, `2` failed. Result fields on history rows: `id, task_id, job_id, generate_url, img_url, thumbnail_url, platform, model, input_model, created_at, pre_consumption_credits, origin_name, json_url, dxf_url, generate_dwg_url`.

---

## 7. Request signing and auth (so you recognize it)

Every call appends `app_id=floor_plan, t, nonce, sign, secret_key` as query params, produced by `Vt("floor_plan")`:
- `t` = unix seconds (UTC), `nonce` = UUID v4.
- A random 16-character key is generated per request.
- `sign` = AES-CBC/PKCS7 (key = IV = that random key) of the string `app_id:<static value>:t:nonce:<encrypted key>`.
- `secret_key` = that random key encrypted with an **RSA public key embedded in the bundle** (JSEncrypt; AES via CryptoJS).

This is anti-abuse obfuscation, not secrecy: the key material ships to every visitor. You do not need to reproduce it. Your own backend should use normal session tokens, rate limits and CAPTCHA/usage quotas instead.

---

## 8. Prompt templates (what the client sends)

### 8.1 Room tab, `generate` (this is the actual floor-plan prompt)

```
You are an expert architectural planner and floor plan designer.
Generate a clean, high-resolution 2D floor plan drawing with the following requirements:
- {roomType}{n}: [{width}x{length}{m2|ft2}]      (one line per room)
- Extra details: {notes}
Drawing requirements:
– Top-down view
– Black-and-white line art only
– Thin 1-pixel black lines on white background
– Minimal furniture icons
– Room labels in {language}, using a clear font that supports the selected language
– No perspectives, colors, shading, or textures
– Center the plan within the canvas, leave at least 50 px margin
Output should be clean, precise, and easy to read, suitable for architectural planning.
```
Style presets add descriptors. Example `technical`: "clean architectural blueprint floorplan, thin black drafting lines on white background, minimal furniture symbols, technical CAD-style layout, precise measurements and labels". `3d-isometric`: "3D isometric floorplan, elevated angled view, detailed furniture and materials, clear room structure, modern architectural visualization". `colored-2d`, `blueprint`, `hand-drawn`, `anime`, `watercolor`, `marker-pen`, `collage`, `realistic` each have their own descriptor string.

### 8.2 Custom tab
The user's prompt plus the structured fields in 4.2.1; the server composes the final prompt [unknown].

### 8.3 Room redesign (`image-to-design`)
"You are an expert interior and architectural designer. Based on the uploaded image, redesign the room with the following requirements: Room type / Style / Extra details. Generate a new realistic image that preserves the original room layout but applies the chosen type, style, and details."

The Floor Plan Visualizer sends only the structured `{view_angle, style, extra_details}` payload; its final text prompt is composed on the server [unknown].

---

## 9. Where things run

| Work | Where | Evidence |
|---|---|---|
| UI, forms, prompt strings, polling | Browser | Vue code |
| SVG scene editing, snapping, undo | Browser | 900+ SVG references, pointer handlers |
| DXF generation (from Creator scene) | **Browser** | embedded DXF writer class |
| 3D viewing (GLB) | Browser, **WebGL** via Three.js r183 | `WebGLRenderer`, `GLTFLoader`, `OrbitControls` chunks |
| PDF/PNG export | Browser (`html2canvas`, `jsPDF`, `pdf.js`) | chunk references |
| Image generation (2D plan, 3D render) | **Remote server / third-party model** | create + poll pattern, credits |
| 3D mesh generation | **Remote server (Hunyuan3D)** | `/v1/model-3d`, `hunyuan/*` |
| Raster to DXF/DWG | **Remote server (vectorizer.ai)** | `/v1/image-to-cad`, `vectorizer.ai` filter |
| Prompt rewrite, plan-JSON agent | **Remote LLMs** | SSE streams, model IDs |
| On-device ML | **None** | no onnxruntime, tfjs, opencv, wasm model files in 568 chunks |

---

## 10. Libraries and stack (frontend)

Nuxt 3 / Vue 3 (Vite build), Pinia, Three.js (r183) with GLTFLoader and OrbitControls, pdf.js, html2canvas, jsPDF, CryptoJS (AES) and JSEncrypt (RSA), an embedded DXF writer (API like `@tarikjabiri/dxf`), lucide icons, `heic` image conversion, Konva reference in the main entry [weak], Tailwind-style utility classes. 7 UI languages (en, es, fr, de, it, pt, nl). Analytics events named like `Generate-plan-floorPlanGenerator`, `Generate-ai-3d`, `Floor-plan-ai-chat`. Backend language/framework: **[unknown]**.

---

## 11. Models and training data: direct answers

| Question | Answer |
|---|---|
| Which models draw the 2D plan? | `nano-banana` (Basic), `gpt-image-2` (Advanced), `nano-banana-pro` (Pro). Vendors inferred: Google Gemini image models and an OpenAI image model. [code for IDs, inferred for vendors] |
| Which model makes 3D meshes? | Tencent Hunyuan3D versions `3.0`, `3.1` and `rapid`. [code] |
| Which model does "Convert to 3D" on the plan page? | Not a 3D model. The same image models, rendering a 3D-style picture. [code] |
| Which makes DXF/DWG? | vectorizer.ai (raster tracing) on the server; Creator scenes are exported to DXF in the browser. [code] |
| Which produce the structured plan JSON? | An LLM selected from GPT-6-Astra, GPT-5.6-Terra/Sol, DeepSeek-V4.1-Flash, DeepSeek-V4-Pro. [code] |
| Prompt rewrite model? | `gemini-3.1-pro-preview`. [code] |
| What data were these trained on? | Not stated anywhere. floor-plan.ai appears to **train nothing itself**, so the training data is whatever each provider used. There is no proprietary floor-plan dataset visible in the product. [inferred] |
| Deep-learning architecture in use? | Diffusion/autoregressive image generators for pictures, an image-to-3D generative model for meshes, transformer LLMs for JSON. None is custom. [inferred] |
| Does it run on my computer? | No. Only the UI, SVG editing, DXF writing and GLB viewing run locally. |

---

## 12. Blueprint for implementing a similar system

This is **recommendation, not observation**. It maps each of their components to something you can build or host. Your project note (`PROJECT.md`) already points at the structured approach, which is the better design.

### 12.1 Architecture to copy (the good parts)

1. **Async job API:** `POST /jobs` returns `task_id`; `GET /jobs/{id}` returns `queued|running|completed|failed`; optional SSE stream for progress. Same shape as theirs, but with real auth and quotas.
2. **Store inputs and outputs in object storage** behind presigned PUT URLs; pass URLs, not bytes.
3. **Separate pipelines per output type** (image, structured plan, mesh, CAD) behind one gateway.
4. **Credits/quotas** server-side only.
5. **Scene JSON as the interchange format** (walls, openings, fixtures, labels), editable in the browser and exportable to DXF.

### 12.2 Where to be *better* than floor-plan.ai (your deep-learning contribution)

| floor-plan.ai | Your version |
|---|---|
| Image model draws a picture; no geometry | **Model outputs the scene JSON directly** (rooms with polygons/rectangles, walls, doors, windows) |
| LLM places numbers by "reasoning", no verification | **Rule checker / solver validates and repairs** (min room sizes, no overlap, reachability, door clearance, setbacks, ventilation) and can be used as an RL reward |
| DXF/3D need re-tracing a PNG | **Geometry is native**, so DXF and a real 3D extrusion (walls + openings) come for free and are exact |
| Generic, no local rules | **Marla/kanal presets and local bylaws** (Pakistan) |
| Opaque third-party models | **Own model, own evaluation** |

### 12.3 Suggested components

| Need | Option |
|---|---|
| Layout generator (core DL) | Fine-tune a small LLM (0.6B to 7B class) to emit the scene JSON from `{plot size, bedrooms, constraints}`; then RL with the rule checker as reward. Alternatives: graph-constrained diffusion (HouseDiffusion), Graph2Plan-style retrieve-and-refine. |
| Training data | RPLAN, CubiCasa5k, ResPlan (17k vector plans, CC BY 4.0, as noted in `PROJECT.md`), plus your own Pakistani plans. Convert all to your scene-JSON schema first. Check each dataset's license. |
| Image-to-plan (upload a drawing) | Raster-to-vector model (Raster2Seq / FloorplanVLM style) or a vision LLM prompted to emit your JSON, then validate. |
| Plan rendering | Draw the JSON yourself (SVG/Canvas): crisp, labeled, dimensioned, no diffusion needed. |
| DXF export | `ezdxf` (Python) on the server, or a JS DXF writer in the browser. |
| 3D walkthrough | Extrude walls from the JSON in Three.js (you already have a walkthrough prototype). For decorative props only, an optional image-to-3D model. |
| Image-based style renders (optional) | Hosted image models (for example the same kind as theirs) or a self-hosted diffusion + ControlNet conditioned on the plan raster. |
| Mesh generation (optional) | Tencent's Hunyuan3D has open-weight releases you can self-host (check the current license and GPU needs). |
| Serving | FastAPI + a job queue (Redis/RQ or Celery); GPU worker for model inference; S3-compatible storage; SSE for progress. |

### 12.4 Minimal API contract to give your agent

```
POST /api/v1/plans                {plot:{w,d,unit}, bedrooms, constraints[], style?, image_url?}  -> {task_id}
GET  /api/v1/plans/{task_id}      -> {status, progress, result?:{scene, checks[], score}}
POST /api/v1/plans/{id}/validate  {scene} -> {ok, violations[]}
POST /api/v1/plans/{id}/export    {format:"dxf"|"png"|"svg"|"glb"} -> {url}
POST /api/v1/uploads/sign         {filename, sha256} -> {upload_url, public_url}
```
Scene JSON: use section 6.1's idea but prefer explicit geometry (`rooms[{id,type,polygon}], walls[{a,b,thickness}], openings[{wall,pos,width,type,swing}], fixtures[{type,x,y,w,h,rot}]`) over their rectangle-and-scale encoding, which is awkward to validate.

---

## 13. Verification gaps (what to confirm if it matters)

1. **Live responses:** run `rea inspect-web-page ... --include-json-body-shapes` while generating once (1 free Basic credit) to record real response bodies and headers.
2. **Real vendors** behind each model ID: only the provider can confirm.
3. **Server-side system prompts** (prompt rewrite, plan-JSON agent): not recoverable from the client.
4. **Training data**: undisclosed; ask the provider if it matters for licensing.
5. `rea export-web-scripts` failed on Windows (ESTALE file-identity error), so scripts were fetched directly from their public URLs; the capture JSON files remain in the session scratchpad.
