# On-device model

The app expects **`yolov8n.tflite`** in this folder. It is created with the official
ultralytics exporter. To avoid downloading TensorFlow (700+ MB) locally, run the export in
[Google Colab](https://colab.research.google.com) (free):

```python
!pip install ultralytics
from ultralytics import YOLO
YOLO('yolov8n.pt').export(format='tflite', imgsz=320)
```

Download `/content/yolov8n.tflite` (about 12 MB) from the Colab file browser and put it here.

Recent ultralytics versions export with Google's LiteRT converter: the model takes
`[1, 3, 320, 320]` (channels first) and outputs `[1, 84, 2100]`. Older TensorFlow-based exports
take `[1, 320, 320, 3]`. The app reads the layout from the model, so both work.

- `imgsz=320` is fast on most phones. `imgsz=640` notices smaller and farther objects but is
  slower. The app reads the input size from the model, so either works without code changes.
- Any YOLOv8/YOLO11 detection model exported this way works (`yolov8s.pt` is more accurate,
  ~22 MB).
