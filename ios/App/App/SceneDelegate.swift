import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = GameViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

// The game's web view: full screen (no status bar, home indicator fades),
// no zoom or scrolling, and the
// game's dark background so nothing flashes white while it loads.
class GameViewController: CAPBridgeViewController {
    private static let pageBackground = UIColor(red: 15 / 255, green: 23 / 255, blue: 32 / 255, alpha: 1) // #0F1720

    override func capacitorDidLoad() {
        view.backgroundColor = GameViewController.pageBackground
        webView?.isOpaque = false
        webView?.backgroundColor = GameViewController.pageBackground
        webView?.scrollView.backgroundColor = GameViewController.pageBackground
        webView?.scrollView.minimumZoomScale = 1
        webView?.scrollView.maximumZoomScale = 1
        webView?.scrollView.bouncesZoom = false
        webView?.scrollView.isScrollEnabled = false
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
}
