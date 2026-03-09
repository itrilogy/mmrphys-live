# torch2onnx/convert_toolbox_physnet.py
import torch
import torch.nn as nn
import onnx
import json
import sys
import os
from pathlib import Path

# Add rPPG-Toolbox to path to import models
sys.path.append(str(Path(__file__).parent.parent / "rPPG-Toolbox"))
from neural_methods.model.PhysNet import PhysNet_padding_Encoder_Decoder_MAX as PhysNet

def convert_physnet_to_onnx(weights_path, onnx_output_path, config_output_path):
    device = torch.device("cpu")
    
    # 1. Initialize Model
    # PhysNet architecture takes (B, C, T, H, W)
    # Using 128 frames as per Toolbox standard
    frames = 128
    height = 72
    width = 72
    
    model = PhysNet(frames=frames).to(device)
    
    # --- FIX: ONNX does not support adaptive_avg_pool3d with dynamic inputs well ---
    # At this point in PhysNet (72x72 input), the spatial dimension is 4x4
    # Replace AdaptiveAvgPool3d with regular AvgPool3d
    model.poolspa = nn.AvgPool3d(kernel_size=(1, 4, 4), stride=(1, 4, 4))
    # ------------------------------------------------------------------------------

    # 2. Load Weights
    print(f"Loading weights from {weights_path}...")
    checkpoint = torch.load(weights_path, map_location=device)
    
    # Handle both full checkpoints and state_dicts
    if isinstance(checkpoint, dict) and 'state_dict' in checkpoint:
        state_dict = checkpoint['state_dict']
    else:
        state_dict = checkpoint
        
    # Remove 'module.' prefix if it exists (from DataParallel)
    new_state_dict = {}
    for k, v in state_dict.items():
        name = k[7:] if k.startswith('module.') else k
        # Skip poolspa weights as we replaced it with a non-parametric version
        if 'poolspa' in name: continue 
        new_state_dict[name] = v
        
    model.load_state_dict(new_state_dict, strict=False)
    model.eval()
    
    # 3. Create Dummy Input
    # PhysNet expects [Batch, Channel, Time, Height, Width]
    dummy_input = torch.randn(1, 3, frames, height, width)
    
    # 4. Export to ONNX
    print(f"Exporting to ONNX: {onnx_output_path}...")
    torch.onnx.export(
        model,
        dummy_input,
        onnx_output_path,
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['rPPG', 'vis1', 'vis2', 'vis3'], # PhysNet returns 4 values
        dynamic_axes={
            'input': {0: 'batch_size', 2: 'frames'},
            'rPPG': {0: 'batch_size', 1: 'frames'}
        }
    )
    
    # 5. Create Config JSON for Web Implementation
    config = {
        "FRAME_NUM": frames,
        "TASKS": ["BVP"],
        "FS": 30,
        "sampling_rate": 30,
        "input_size": [1, 3, frames, height, width],
        "output_names": ["rPPG"], 
        "model_path": f"/models/physnet/{Path(onnx_output_path).name}",
        "model_info": {
            "name": "PhysNet_PURE",
            "version": "1.0",
            "description": "PhysNet model trained on PURE dataset"
        },
        "signal_parameters": {
            "bvp": {
                "min_rate": 40,
                "max_rate": 180,
                "buffer_size": frames
            }
        }
    }
    
    with open(config_output_path, 'w') as f:
        json.dump(config, f, indent=4)
    print(f"Config created at {config_output_path}")

if __name__ == "__main__":
    weights = "rPPG-Toolbox/final_model_release/PURE_PhysNet_DiffNormalized.pth"
    onnx_out = "public/models/physnet/model.onnx"
    config_out = "public/models/physnet/config.json"
    
    os.makedirs(os.path.dirname(onnx_out), exist_ok=True)
    convert_physnet_to_onnx(weights, onnx_out, config_out)
