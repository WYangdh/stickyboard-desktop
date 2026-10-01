// 深蓝随便签 StickyBoard · Tauri v2 外壳
// 职责：注册通知插件 + 系统托盘（新建/全部放回/退出），其余全在前端 daemon 窗
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle();
            let new_i = MenuItem::with_id(handle, "new", "新建便签", true, None::<&str>)?;
            let back_i = MenuItem::with_id(handle, "restore", "把归档放回桌面", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(handle)?;
            let quit_i = MenuItem::with_id(handle, "quit", "退出便签台", true, None::<&str>)?;
            let menu = Menu::with_items(handle, &[&new_i, &back_i, &sep, &quit_i])?;

            let mut builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("便签台 StickyBoard")
                .on_menu_event(|app, event| {
                    if let Some(d) = app.get_webview_window("daemon") {
                        // tauri 2.x：事件 id 走访问器（字段形式在新版已私有化）
                        match event.id().as_ref() {
                            "new" => { let _ = d.emit("tray-new", ()); }
                            "restore" => { let _ = d.emit("tray-restore", ()); }
                            "quit" => { app.exit(0); }
                            _ => {}
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            let _tray = builder.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("StickyBoard 启动失败：请确认 dist-web/ 与 icons/ 已就绪");
}
