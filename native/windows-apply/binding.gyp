{
  "targets": [
    {
      "target_name": "windows_apply",
      "sources": ["windows_apply.cc"],
      "defines": ["NAPI_VERSION=9", "UNICODE", "_UNICODE", "WIN32_LEAN_AND_MEAN"]
    }
  ]
}
