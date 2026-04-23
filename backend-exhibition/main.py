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

def get_horizontal_position(box, img_width):
    center_x = (box[0] + box[2]) / 2
    ratio = center_x / img_width
    if ratio < 0.35:
        return "on your left"
    elif ratio > 0.65:
        return "on your right"
    else:
        return "ahead of you"

def describe_scene(results, img):
    img_height, img_width = img.shape[:2]
    img_area = img_height * img_width

    boxes = results.boxes.xyxy.cpu().numpy()
    classes = results.boxes.cls.cpu().numpy()
    confidences = results.boxes.conf.cpu().numpy()

    if len(boxes) == 0:
        return "No objects detected", False

    # Check for close obstacles first
    for i, box in enumerate(boxes):
        box_area = (box[2] - box[0]) * (box[3] - box[1])
        if box_area / img_area > 0.25:
            label = model.names[int(classes[i])]
            position = get_horizontal_position(box, img_width)
            return f"Warning! {label} very close {position}!", True

    # Build smart description for up to 3 objects
    seen = {}
    for i, box in enumerate(boxes):
        label = model.names[int(classes[i])]
        conf = confidences[i]
        if label not in seen and conf > 0.4:
            position = get_horizontal_position(box, img_width)
            seen[label] = position
        if len(seen) == 3:
            break

    if not seen:
        return "No objects detected", False

    parts = []
    for label, position in seen.items():
        parts.append(f"a {label} {position}")

    if len(parts) == 1:
        text = f"There is {parts[0]}."
    elif len(parts) == 2:
        text = f"There is {parts[0]} and {parts[1]}."
    else:
        text = f"There is {parts[0]}, {parts[1]}, and {parts[2]}."

    return text, False

def read_text(img):
    # Resize for faster OCR processing
    small = cv2.resize(img, (640, 480))
    results = ocr_reader.readtext(small)
    
    # Only keep high confidence results
    texts = [r[1] for r in results if r[2] > 0.5]
    
    if not texts:
        return None
    
    combined = " ".join(texts[:5])  # max 5 text chunks
    return combined

@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    img_bytes = await file.read()
    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)

    # Run YOLO detection
    results = model(img)[0]
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