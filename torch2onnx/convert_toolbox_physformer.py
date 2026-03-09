# torch2onnx/convert_toolbox_physformer.py
import torch
import onnx
import json
import sys
import os
from pathlib import Path

# Add rPPG-Toolbox to path to import models
sys.path.append(str(Path(__file__).parent.parent / "rPPG-Toolbox"))
from neural_methods.model.PhysFormer import ViT_ST_ST_Compact3_TDC_gra_sharp as PhysFormer

def convert_physformer_to_onnx(weights_path, onnx_output_path, config_output_path):
    device = torch.device("cpu")
    
    # Correct config based on size mismatch findings:
    # patch_embedding.weight shape should be [dim, dim, 4, 4, 4]
    # This means patches=(4, 4, 4)
    frames = 160 
    height = 128 
    width = 128
    
    # Initialize Model
    model = PhysFormer(
        name='PhysFormer', 
        patches=(4, 4, 4), # Corrected from (4, 16, 16)
        dim=96,            # Matches upsample2
        ff_dim=144,        
        num_heads=12,
        num_layers=12,
        dropout_rate=0.0,
        frame=frames,
        image_size=(frames, height, width),
        theta=0.7
    ).to(device)
    
    # Load Weights
    print(f"Loading weights from {weights_path}...")
    checkpoint = torch.load(weights_path, map_location=device)
    
    if isinstance(checkpoint, dict) and 'state_dict' in checkpoint:
        state_dict = checkpoint['state_dict']
    else:
        state_dict = checkpoint
        
    new_state_dict = {}
    for k, v in state_dict.items():
        name = k[7:] if k.startswith('module.') else k
        new_state_dict[name] = v
        
    # Final check: Does total patches match?
    # gh * gw * gt = (128//4) * (128//4) * (160//4) = 32 * 32 * 40 = 40960
    # In PhysFormer.py: seq_len = gh * gw * gt
    
    model.load_state_dict(new_state_dict, strict=True) # Try strict=True now that we think we have all params
    model.eval()
    
    # Dummy Inputs
    dummy_input = torch.randn(1, 3, frames, height, width)
    gra_sharp = torch.tensor(1.0) 
    
    print(f"Exporting PhysFormer (dim=96, patches=(4,4,4)) to {onnx_output_path}...")
    torch.onnx.export(
        model,
        (dummy_input, gra_sharp),
        onnx_output_path,
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=['input', 'gra_sharp'],
        output_names=['rPPG', 'score1', 'score2', 'score3'],
        dynamic_axes={
            'input': {0: 'batch_size', 2: 'frames'},
            'rPPG': {0: 'batch_size', 1: 'frames'}
        }
    )
    
    # Create Web Config
    config = {
        "FRAME_NUM": frames,
        "TASKS": ["BVP"],
        "FS": 30,
        "sampling_rate": 30,
        "input_size": [1, 3, frames, height, width],
        "output_names": ["rPPG"],
        "model_path": f"/models/physformer/{Path(onnx_output_path).name}",
        "model_info": {
            "name": "PhysFormer_PURE_Expert",
            "version": "1.0",
            "description": "High precision Transformer-based model (Expert Scene)"
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
        
    print(f"PhysFormer Config generated at {config_output_path}")

if __name__ == "__main__":
    weights = "rPPG-Toolbox/final_model_release/PURE_PhysFormer_DiffNormalized.pth"
    onnx_out = "public/models/physformer/model.onnx"
    config_out = "public/models/physformer/config.json"
    
    os.makedirs(os.path.dirname(onnx_out), exist_ok=True)
    convert_physformer_to_onnx(weights, onnx_out, config_out)
