import UIKit
import FirebaseCore
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Firebase 설정이 주입된 배포/QA 빌드에서만 default app을 초기화한다.
    // 설정이 없는 로컬 UI 빌드는 offline runtime으로 안전하게 기동한다.
    if FirebaseApp.app() == nil,
       Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
      FirebaseApp.configure()
    }

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "Daoewo",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG && DAOEWO_CONTENT_PREVIEW
    contentPreviewBundleURL()
#elseif DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

#if DEBUG && DAOEWO_CONTENT_PREVIEW
  private func contentPreviewBundleURL() -> URL? {
    let host: String
    if let ipPath = Bundle.main.path(forResource: "ip", ofType: "txt"),
       let ipContents = try? String(contentsOfFile: ipPath, encoding: .utf8) {
      let trimmed = ipContents.trimmingCharacters(in: .whitespacesAndNewlines)
      host = trimmed.isEmpty ? "localhost" : trimmed
    } else {
      host = "localhost"
    }

    let previewMetroHost = "\(host):8082"
    if RCTBundleURLProvider.isPackagerRunning(previewMetroHost) {
      var components = URLComponents()
      components.scheme = "http"
      components.host = host
      components.port = 8082
      components.path = "/index.preview.bundle"
      components.queryItems = [
        URLQueryItem(name: "platform", value: "ios"),
        URLQueryItem(name: "dev", value: "true"),
        URLQueryItem(name: "minify", value: "false"),
        URLQueryItem(name: "modulesOnly", value: "false"),
        URLQueryItem(name: "runModule", value: "true"),
      ]
      return components.url
    }

    return Bundle.main.url(forResource: "preview", withExtension: "jsbundle")
  }
#endif
}
