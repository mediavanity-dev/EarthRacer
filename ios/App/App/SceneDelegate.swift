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

    // iOS shows a snapshot of the app while it comes back to the front, and a WebGL view can leave
    // a stale one (a vehicle you've since swapped). Cover the game with its plain background when
    // it goes to the background, so the snapshot is neutral, and uncover once it has redrawn.
    private var cover: UIView?
    func sceneDidEnterBackground(_ scene: UIScene) {
        guard let window = window, cover == nil else { return }
        let v = UIView(frame: window.bounds)
        v.backgroundColor = UIColor(red: 15 / 255, green: 23 / 255, blue: 32 / 255, alpha: 1)
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(v)
        cover = v
    }
    func sceneDidBecomeActive(_ scene: UIScene) {
        guard let v = cover else { return }
        cover = nil
        UIView.animate(withDuration: 0.25, delay: 0.2, options: [], animations: { v.alpha = 0 }, completion: { _ in v.removeFromSuperview() })
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

// The game's web view (the status bar is hidden by Info.plist):
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

}
