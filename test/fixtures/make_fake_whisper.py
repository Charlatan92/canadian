"""Faux modèle Whisper minuscule (quelques Ko) pour tester toute la chaîne de reconnaissance
vocale de l'app sans télécharger le vrai modèle : proxy Hugging Face, transformers.js dans un
worker, ONNX Runtime WebAssembly, décodage, repérage des noms.

Le décodeur est une chaîne déterministe : quel que soit le son, il "transcrit"
« Caufield to Suzuki ». Mêmes noms d'entrées/sorties que les exports onnx-community/whisper-*.

Usage : python make_fake_whisper.py <dossier de sortie>   (paquet Python requis : onnx)
"""

import json
import os
import shutil
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

OUT = sys.argv[1] if len(sys.argv) > 1 else "fake-whisper"
D = 8  # d_model (1 couche, 1 tête : head_dim = 8)

# Les mots d'abord, puis les jetons spéciaux, <|notimestamps|> en dernier (les horodatages suivent)
WORDS = ["ĠCaufield", "Ġto", "ĠSuzuki"]
SPECIAL = ["<|endoftext|>", "<|startoftranscript|>", "<|en|>", "<|fr|>", "<|translate|>", "<|transcribe|>", "<|notimestamps|>"]
VOCAB = WORDS + SPECIAL
ID = {t: i for i, t in enumerate(VOCAB)}
V = len(VOCAB)
EOT, SOT, NOTS = ID["<|endoftext|>"], ID["<|startoftranscript|>"], ID["<|notimestamps|>"]

# Transitions : notimestamps -> Caufield -> to -> Suzuki -> fin ; tout le reste -> fin
nxt = {NOTS: 0, 0: 1, 1: 2, 2: EOT}
T = np.zeros((V, V), np.float32)
for i in range(V):
    T[i, nxt.get(i, EOT)] = 30.0


def encoder():
    w = numpy_helper.from_array(np.random.RandomState(0).randn(160, D).astype(np.float32) * 0.01, "W")
    shape = numpy_helper.from_array(np.array([0, 1500, 160], np.int64), "shape")
    nodes = [
        helper.make_node("Transpose", ["input_features"], ["t"], perm=[0, 2, 1]),
        helper.make_node("Reshape", ["t", "shape"], ["r"]),
        helper.make_node("MatMul", ["r", "W"], ["last_hidden_state"]),
    ]
    g = helper.make_graph(
        nodes,
        "encoder",
        [helper.make_tensor_value_info("input_features", TensorProto.FLOAT, ["batch", 80, 3000])],
        [helper.make_tensor_value_info("last_hidden_state", TensorProto.FLOAT, ["batch", 1500, D])],
        [w, shape],
    )
    return g


def decoder():
    trans = numpy_helper.from_array(T, "T")
    emb = numpy_helper.from_array(np.random.RandomState(1).randn(V, D).astype(np.float32), "E")
    axes1 = numpy_helper.from_array(np.array([1], np.int64), "axes1")
    pkv = lambda kind, part: f"past_key_values.0.{kind}.{part}"
    prs = lambda kind, part: f"present.0.{kind}.{part}"
    nodes = [
        helper.make_node("Gather", ["T", "input_ids"], ["logits"], axis=0),
        helper.make_node("Gather", ["E", "input_ids"], ["e"], axis=0),
        helper.make_node("Unsqueeze", ["e", "axes1"], ["new_kv"]),
        helper.make_node("Concat", [pkv("decoder", "key"), "new_kv"], [prs("decoder", "key")], axis=2),
        helper.make_node("Concat", [pkv("decoder", "value"), "new_kv"], [prs("decoder", "value")], axis=2),
        helper.make_node("Unsqueeze", ["encoder_hidden_states", "axes1"], [prs("encoder", "key")]),
        helper.make_node("Unsqueeze", ["encoder_hidden_states", "axes1"], [prs("encoder", "value")]),
    ]
    f = TensorProto.FLOAT
    inputs = [
        helper.make_tensor_value_info("input_ids", TensorProto.INT64, ["batch", "seq"]),
        helper.make_tensor_value_info("encoder_hidden_states", f, ["batch", 1500, D]),
        helper.make_tensor_value_info(pkv("decoder", "key"), f, ["batch", 1, "past", D]),
        helper.make_tensor_value_info(pkv("decoder", "value"), f, ["batch", 1, "past", D]),
        helper.make_tensor_value_info(pkv("encoder", "key"), f, ["batch", 1, "enc", D]),
        helper.make_tensor_value_info(pkv("encoder", "value"), f, ["batch", 1, "enc", D]),
        helper.make_tensor_value_info("use_cache_branch", TensorProto.BOOL, [1]),
    ]
    outputs = [
        helper.make_tensor_value_info("logits", f, ["batch", "seq", V]),
        helper.make_tensor_value_info(prs("decoder", "key"), f, ["batch", 1, "total", D]),
        helper.make_tensor_value_info(prs("decoder", "value"), f, ["batch", 1, "total", D]),
        helper.make_tensor_value_info(prs("encoder", "key"), f, ["batch", 1, 1500, D]),
        helper.make_tensor_value_info(prs("encoder", "value"), f, ["batch", 1, 1500, D]),
    ]
    return helper.make_graph(nodes, "decoder_merged", inputs, outputs, [trans, emb, axes1])


def save(graph, path):
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], ir_version=8)
    onnx.checker.check_model(model)
    onnx.save(model, path)


os.makedirs(os.path.join(OUT, "onnx"), exist_ok=True)
save(encoder(), os.path.join(OUT, "onnx", "encoder_model.onnx"))
save(decoder(), os.path.join(OUT, "onnx", "decoder_model_merged.onnx"))
# Mêmes fichiers sous les noms des variantes quantifiées demandées par l'app
for suffix in ["_quantized", "_q4", "_fp16"]:
    for name in ["encoder_model", "decoder_model_merged"]:
        shutil.copy(os.path.join(OUT, "onnx", f"{name}.onnx"), os.path.join(OUT, "onnx", f"{name}{suffix}.onnx"))

config = {
    "model_type": "whisper",
    "architectures": ["WhisperForConditionalGeneration"],
    "d_model": D,
    "encoder_layers": 1,
    "decoder_layers": 1,
    "encoder_attention_heads": 1,
    "decoder_attention_heads": 1,
    "num_mel_bins": 80,
    "max_source_positions": 1500,
    "max_target_positions": 32,
    "vocab_size": V,
    "decoder_start_token_id": SOT,
    "eos_token_id": EOT,
    "pad_token_id": EOT,
    "bos_token_id": EOT,
    "is_encoder_decoder": True,
}
generation = {
    "decoder_start_token_id": SOT,
    "eos_token_id": EOT,
    "pad_token_id": EOT,
    "bos_token_id": EOT,
    "is_multilingual": True,
    "lang_to_id": {"<|en|>": ID["<|en|>"], "<|fr|>": ID["<|fr|>"]},
    "task_to_id": {"translate": ID["<|translate|>"], "transcribe": ID["<|transcribe|>"]},
    "no_timestamps_token_id": NOTS,
    "max_length": 32,
    "begin_suppress_tokens": [],
    "suppress_tokens": [],
    "max_initial_timestamp_index": 50,
}
preprocessor = {
    "feature_extractor_type": "WhisperFeatureExtractor",
    "processor_class": "WhisperProcessor",
    "feature_size": 80,
    "hop_length": 160,
    "n_fft": 400,
    "n_samples": 480000,
    "nb_max_frames": 3000,
    "chunk_length": 30,
    "padding_side": "right",
    "padding_value": 0.0,
    "return_attention_mask": False,
    "sampling_rate": 16000,
}
added = [
    {"id": ID[t], "content": t, "single_word": False, "lstrip": False, "rstrip": False, "normalized": False, "special": True}
    for t in SPECIAL
]
tokenizer = {
    "version": "1.0",
    "truncation": None,
    "padding": None,
    "added_tokens": added,
    "normalizer": None,
    "pre_tokenizer": {"type": "ByteLevel", "add_prefix_space": False, "trim_offsets": True, "use_regex": True},
    "post_processor": None,
    "decoder": {"type": "ByteLevel", "add_prefix_space": True, "trim_offsets": True, "use_regex": True},
    "model": {
        "type": "BPE",
        "dropout": None,
        "unk_token": None,
        "continuing_subword_prefix": "",
        "end_of_word_suffix": "",
        "fuse_unk": False,
        "byte_fallback": False,
        "vocab": ID,
        "merges": [],
    },
}
tokenizer_config = {
    "tokenizer_class": "WhisperTokenizer",
    "model_max_length": 1024,
    "bos_token": "<|endoftext|>",
    "eos_token": "<|endoftext|>",
    "unk_token": "<|endoftext|>",
    "pad_token": "<|endoftext|>",
    "add_prefix_space": False,
    "errors": "replace",
}
for name, obj in [
    ("config.json", config),
    ("generation_config.json", generation),
    ("preprocessor_config.json", preprocessor),
    ("tokenizer.json", tokenizer),
    ("tokenizer_config.json", tokenizer_config),
]:
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)
print("faux Whisper écrit dans", OUT)
