# Transcribing a real plan image

You read one plan image and write what is on it as a room list: one JSON file per plan, `real/hand/<id>.json`. The
geometry is finished by `real/assemble.py` (rows scaled to the plot, 0.5 ft grid), so your job is to read the plan
faithfully: which rooms, where, how big. Then run the check and look at the drawing it makes.

## 1. Look at the image

- The road side is where the main gate, porch, car parking or the word "road" is. Plans are often drawn with the road
  at the top, left or right: turn the plan in your head so the **road is at the front (row 1)**. "Left" and "right" are
  as seen from the road, looking at the house.
- Use the **ground floor** only for `rooms`. If the same sheet also shows the first floor clearly, transcribe it too
  under `first_floor` (same format, same plot and same orientation).
- Sizes: printed as `13'-6"x14'-0"` = 13.5 x 14. Width first means across (left to right as seen from the road), depth
  second means from the road toward the back. When the plan is turned, the printed width may be the depth: decide from
  the drawing, not from the label order. Round to 0.5 ft.

## 2. Skip the image when

- It is Indian (pooja room, vastu, BHK, sit-out, measurements in metres) or not a house (apartment block, shop, office).
- There is no readable ground floor: elevations, 3D renders, sketches with no sizes, a blurred thumbnail.
- The plot size cannot be found. Use the printed plot size (`35'x65'`, `Plot 30x60`), or work it out from the overall
  dimension lines. A marla count alone is enough only with the usual size: 3 marla 20x34, 5 marla 25x45, 7 marla 30x52,
  8 marla 30x60, 10 marla 35x65, 1 kanal 50x90, 2 kanal 75x120. Never guess beyond that.

Write `{"id": "<id>", "skip": "<short reason>"}` and move on.

## 3. The room list

```json
{"id": "fd08d033d7d0e2c3", "image": "images/fd08d033d7d0e2c3.jpg",
 "note": "8 marla 30x60 Lahore: double porch, drawing room with front lawn, TV lounge with stairs, two beds at the back",
 "drawn": "road on the right",
 "rooms": {"plot": [30, 60],
   "rows": [[{"t": "lawn", "w": 30, "d": 5}],
            [{"t": "porch", "w": 18, "d": 21}, {"t": "drawing", "w": 12, "d": 12}],
            ...],
   "baths": [{"row": 4, "col": 2, "w": 6, "d": 7.5, "side": "L"}]},
 "first_floor": null}
```

- `rows`: bands across the whole plot, from the road (row 1) to the back. Each row lists, left to right, everything
  across the plot: rooms, open spaces, and the side setbacks or side passages as `void`. Widths in a row should add up
  to about the plot width; row depths to about the plot depth (front lawn and back yard included).
- Each item: `t` (type), `w` (width), `d` (its own depth as printed). A row takes the depth of its main rooms, so when
  rooms in one row differ in depth, give each its own printed size.
- A room that spans two rows (a long lounge): put it in the row that holds most of it. Being close is fine; the plan
  language is rows of rooms and cannot copy every jog.
- `baths`: each washroom belongs to the room it opens from: `row` and `col` are 1-based positions in `rows`; `side` is
  the back corner it sits in (L or R as seen from the road). A common washroom off a lounge or passage goes on that
  room. A dressing area between a bedroom and its washroom is part of the bedroom.
- Types: `bed`, `master` (the largest bedroom with its own washroom), `drawing`, `lounge` (TV lounge, family, living,
  sitting), `dining`, `kitchen`, `lobby` (entrance, foyer), `stairs`, `store` (also laundry, utility), `passage`
  (corridor), `dress`, `servant`, `prayer`, `study`, `porch` (car porch, garage), `lawn` (front or back lawn, verandah,
  ground-floor terrace), `courtyard` (open to sky, light well), `void` (setbacks, side and back passages, open space).
- `note`: one line in your own words (plot, city or society if printed, what is special).
- `drawn`: where the road is on the image (`road at the bottom`, `on the top`, `on the left`, `on the right`).

## 4. Check, look, fix once

```
python real/check_hand.py <id>
```

It assembles the plan, compares it with the room sizes our OCR read from the same image, and draws it to
`real/hand/render/<id>.png` (road at the bottom). Open that drawing next to the image: rooms in the right rows and
order, the right sizes, washrooms on the right rooms. If something is wrong, fix the JSON and run the check once more.
"agreement" is the share of the OCR'd sizes your list reproduces; below 0.6 usually means a misread or a turned plan
(OCR sometimes misreads too, so trust the image when they disagree). Design-rule failures (for example "missing
drawing") are fine: write what the plan shows.
