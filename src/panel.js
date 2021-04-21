'use strict';

const { St, Shell, Meta, Gio, GLib } = imports.gi;
const Main = imports.ui.main;
const backgroundSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' })

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Settings = Me.imports.settings;
let prefs = new Settings.Prefs;

const dash_to_panel_uuid = 'dash-to-panel@jderose9.github.com';
const default_sigma = 30;
const default_brightness = 0.6;

// useful
const setTimeout = function (func, delay, ...args) {
    return GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
        func(...args);
        return GLib.SOURCE_REMOVE;
    });
};

var PanelBlur = class PanelBlur {
    constructor(connections) {
        this.connections = connections;
        this.effect = new Shell.BlurEffect({
            brightness: default_brightness,
            sigma: default_sigma,
            mode: prefs.STATIC_BLUR.get() ? 0 : 1
        });
        this.background_parent = new St.Widget({
            style_class: 'topbar-blurred-background-parent',
            x: this.monitor.x,
            y: this.monitor.y,
            width: this.monitor.width,
            height: 0,
        });
        this.background = prefs.STATIC_BLUR.get() ? new Meta.BackgroundActor : new St.Widget({
            style_class: 'topbar-blurred-background',
            x: 0,
            y: 0,
            width: this.monitor.width,
            height: Main.panel.height,
        });
        this.background_parent.add_child(this.background);
    }

    enable() {
        this._log("blurring top panel");

        this.connections.connect(Main.extensionManager, 'extension-state-changed', (data, extension) => {
            if (extension.uuid === dash_to_panel_uuid && extension.state === 1) {
                // doesn't work
                this._log("Dash to Panel detected, resetting panel blur")
                setTimeout(() => {
                    this.disable();
                    this.enable();
                }, 500);
            }
        });

        // insert background parent
        Main.panel.get_parent().insert_child_at_index(this.background_parent, 0);
        // hide corners, can't style them
        Main.panel._leftCorner.hide();
        Main.panel._rightCorner.hide();

        // perform updates
        this.change_blur_type();

        // connect to size, monitor or wallpaper changes
        this.connections.connect(Main.panel, 'notify::height', () => {
            this.update_size(prefs.STATIC_BLUR.get());
        });
        this.connections.connect(Main.layoutManager, 'monitors-changed', () => {
            this.update_wallpaper(prefs.STATIC_BLUR.get());
            this.update_size(prefs.STATIC_BLUR.get());
        });
        this.connections.connect(backgroundSettings, 'changed', () => {
            setTimeout(() => { this.update_wallpaper(prefs.STATIC_BLUR.get()) }, 100);
        });
    }

    change_blur_type() {
        let is_static = prefs.STATIC_BLUR.get();

        this.background_parent.remove_child(this.background);
        this.background.remove_effect(this.effect);
        this.background = is_static ? new Meta.BackgroundActor : new St.Widget({
            style_class: 'topbar-blurred-background',
            x: 0,
            y: 0,
            width: this.monitor.width,
            height: Main.panel.height,
        });
        this.effect.set_mode(is_static ? 0 : 1);
        this.background.add_effect(this.effect);
        this.background_parent.add_child(this.background);

        this.update_wallpaper(is_static);
        this.update_size(is_static);

        // HACK
        if (!is_static) {
            // ! DIRTY PART: hack because `Shell.BlurEffect` does not repaint when shadows are under it
            // ! this does not entirely fix this bug (shadows caused by windows still cause artefacts)
            // ! but it prevents the shadows of the panel buttons to cause artefacts on the panel itself
            // ! note: issue opened at https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/2857

            if (prefs.HACKS_LEVEL.get() == 1) {
                this._log("panel hack level 1");

                let rp = () => {
                    this.effect.queue_repaint()
                };

                this.connections.connect(Main.panel, 'enter-event', rp);
                this.connections.connect(Main.panel, 'leave-event', rp);
                this.connections.connect(Main.panel, 'button-press-event', rp);

                Main.panel.get_children().forEach(child => {
                    this.connections.connect(child, 'enter-event', rp);
                    this.connections.connect(child, 'leave-event', rp);
                    this.connections.connect(child, 'button-press-event', rp);
                });
            } else if (prefs.HACKS_LEVEL.get() == 2) {
                this._log("panel hack level 2");

                // disabled because of #31
                /*
                Main.panel.get_children().forEach(child => {
                    this.connections.connect(child, 'paint', () => {
                        this.effect.queue_repaint();
                    });
                });
                */
            }

            // ! END OF DIRTY PART
        }
    }

    update_wallpaper(is_static) {
        if (is_static) {
            let bg = Main.layoutManager._backgroundGroup.get_child_at_index(this.monitor.index);
            this.background.set_content(bg.get_content());
        }
    }

    update_size(is_static) {
        if (is_static) {
            this.background.set_clip(
                this.monitor.x,
                this.monitor.y,
                Main.panel.width,
                Main.panel.height
            );
        } else {
            this.background.height = Main.panel.height
            this.background.width = this.monitor.width;
            this.background_parent.width = this.monitor.width;
        }
    }

    get monitor() {
        return Main.layoutManager.primaryMonitor
    }

    set_sigma(s) {
        this.effect.sigma = s;
    }

    set_brightness(b) {
        this.effect.brightness = b;
    }

    disable() {
        this._log("removing blur from top panel");

        Main.panel._leftCorner.show();
        Main.panel._rightCorner.show();

        try {
            this.background_parent.get_parent().remove_child(this.background_parent);
        } catch (e) { }
    }

    show() {
        this.background_parent.show();
    }
    hide() {
        this.background_parent.hide();
    }

    _log(str) {
        log(`[Blur my Shell] ${str}`)
    }
}
