import os
import random

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

# Pick a model size with the YOLO_MODEL env var: yolov8n.pt (fastest),
# yolov8s.pt, yolov8m.pt (default), yolov8l.pt (most accurate, slowest).
# Weights download automatically on first run.
model = YOLO(os.getenv("YOLO_MODEL", "yolov8m.pt"))


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
    "Be careful, there's {thing} very close {position}",
    "Watch out, {thing} is right {position}",
    "Caution, you're very close to {thing} {position}",
]


def with_article(label):
    """'apple' -> 'an apple', 'chair' -> 'a chair'."""
    return f"an {label}" if label[:1].lower() in "aeiou" else f"a {label}"

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
            text = template.format(thing=with_article(label), position=pos_phrase)
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

    parts = [f"{with_article(label)} {pos}" for label, pos in seen.items()]
    intro = random.choice(INTRO_PHRASES)

    if len(parts) == 1:
        return f"{intro} {parts[0]}.", False
    return f"{intro} {', '.join(parts[:-1])}, and {parts[-1]}.", False

def read_text(img):
    small = cv2.resize(img, (640, 480))
    results = ocr_reader.readtext(small)
    texts = [r[1] for r in results if r[2] > 0.5]
    if not texts:
        return None
    return " ".join(texts[:4])

# Plain `def` (not async): FastAPI runs it in a worker thread, so slow
# model inference doesn't block the server from accepting other requests.
@app.post("/detect")
def detect(file: UploadFile = File(...)):
    img_bytes = file.file.read()
    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return {"text": "Sorry, I could not read that picture. Trying again.", "warning": False}

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