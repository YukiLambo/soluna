import Foundation
import Capacitor
import WidgetKit

/// Lets the web app hand the next 7 days of readings to the home-screen widget.
@objc(SolunaWidgetPlugin)
public class SolunaWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SolunaWidgetPlugin"
    public let jsName = "SolunaWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setDays", returnType: CAPPluginReturnPromise)
    ]
    static let group = "group.app.soluna.ios"

    @objc func setDays(_ call: CAPPluginCall) {
        let ud = UserDefaults(suiteName: SolunaWidgetPlugin.group)
        ud?.set(call.getString("days") ?? "[]", forKey: "days")
        ud?.set(call.getString("name") ?? "", forKey: "name")
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
