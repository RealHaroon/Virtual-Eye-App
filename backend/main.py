from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
import cv2, numpy as np

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

model = YOLO("yolov8n.pt")  # downloads automatically (~6MB)

def describe(labels):
    if not labels:
        return "No objects detected"
    unique = list(dict.fromkeys(labels))[:3]
    return "I see " + ", ".join(unique) + " ahead of you"

@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    img_bytes = await file.read()
    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    results = model(img)[0]
    labels = [model.names[int(c)] for c in results.boxes.cls]
    text = describe(labels)
    print(f"Detected: {text}")
    return {"text": text}