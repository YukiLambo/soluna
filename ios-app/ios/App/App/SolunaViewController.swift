import UIKit
import Capacitor

/// Registers the app's own plugins (the widget bridge) with Capacitor.
class SolunaViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SolunaWidgetPlugin())
    }
}
