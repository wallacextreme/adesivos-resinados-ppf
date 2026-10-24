#[tauri::command]
fn health_check() -> &'static str {
    "SPORTINOX_TAURI_V2_OK"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![health_check])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar aplicativo nativo Sportinox Catálogo de Balcão");
}
