from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
import cv2, numpy as np
import easyocr

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

# model = YOLO("yolov8n.pt")
# model = YOLO("yolov8s.pt")
model = YOLO("yolov8m.pt")
# model = YOLO("yolov8l.pt")


ocr_reader = easyocr.Reader(['en'], gpu=False)  # downloads model on first run



    # Natural assistant-style sentence templates
POSITION_PHRASES = {
    "left":   ["on your left", "to your left side", "on the left"],
    "right":  ["on your right", "to your right side", "on the right"],
    "center": ["in front of you", "straight ahead", "directly ahead"]
}

INTRO_PHRASES = [
    "I can see",
    "I notice",
    "There is",
    "I can make out",
    "I'm detecting"
]

OBSTACLE_PHRASES = [
    "Be careful, there's a {label} very close {position}",
    "Watch out, a {label} is right {position}",
    "Caution, you're very close to a {label} {position}",
]

import random

def get_position(box, img_width):
    center_x = (box[0] + box[2]) / 2
    ratio = center_x / img_width
    if ratio < 0.35:
        return "left"
    elif ratio > 0.65:
        return "right"
    else:
        return "center"


def describe_scene(results, img):
    img_height, img_width = img.shape[:2]
    img_area = img_height * img_width

    boxes = results.boxes.xyxy.cpu().numpy()
    classes = results.boxes.cls.cpu().numpy()
    confidences = results.boxes.conf.cpu().numpy()

    if len(boxes) == 0:
        return "The path ahead looks clear.", False

    # Check for close obstacles
    for i, box in enumerate(boxes):
        box_area = (box[2] - box[0]) * (box[3] - box[1])
        if box_area / img_area > 0.25:
            label = model.names[int(classes[i])]
            pos_key = get_position(box, img_width)
            pos_phrase = random.choice(POSITION_PHRASES[pos_key])
            template = random.choice(OBSTACLE_PHRASES)
            text = template.format(label=label, position=pos_phrase)
            return text, True

    # Build natural description
    seen = {}
    for i, box in enumerate(boxes):
        label = model.names[int(classes[i])]
        conf = confidences[i]
        if label not in seen and conf > 0.25:
            pos_key = get_position(box, img_width)
            seen[label] = random.choice(POSITION_PHRASES[pos_key])
        if len(seen) == 3:
            break

    if not seen:
        return "The path ahead looks clear.", False

    items = list(seen.items())
    intro = random.choice(INTRO_PHRASES)

    if len(items) == 1:
        label, pos = items[0]
        return f"{intro} a {label} {pos}.", False
    elif len(items) == 2:
        return f"{intro} a {items[0][0]} {items[0][1]}, and a {items[1][0]} {items[1][1]}.", False
    else:
        return f"{intro} a {items[0][0]} {items[0][1]}, a {items[1][0]} {items[1][1]}, and a {items[2][0]} {items[2][1]}.", False

def read_text(img):
    small = cv2.resize(img, (640, 480))
    results = ocr_reader.readtext(small)
    texts = [r[1] for r in results if r[2] > 0.5]
    if not texts:
        return None
    combined = " ".join(texts[:4])
    return f"I can read the following text: {combined}"

@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    img_bytes = await file.read()
    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)

    # Run YOLO detection
    results = model(img, conf=0.25, imgsz=960)[0]
    scene_text, is_warning = describe_scene(results, img)

    # Run OCR only if no warning (don't interrupt obstacle alerts)
    ocr_text = None
    if not is_warning:
        ocr_text = read_text(img)

    # Build final response
    if is_warning:
        final_text = scene_text
    elif ocr_text:
        final_text = f"{scene_text} I can also read text: {ocr_text}"
    else:
        final_text = scene_text

    print(f"→ {final_text}")
    return {"text": final_text, "warning": is_warning}