fn main() {
    tauri_plugin::Builder::new(&["invoke", "host_response", "prompt"]).build();
}
