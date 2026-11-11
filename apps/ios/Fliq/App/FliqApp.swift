import SwiftUI

@main
struct FliqApp: App {
    @State private var environment = AppEnvironment.live()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if environment.profile.isOnboarded {
                    RootView()
                        .fullScreenCover(isPresented: .constant(environment.lock.needsSetup)) {
                            SecureFliqView(lock: environment.lock)
                                .preferredColorScheme(.dark)
                        }
                } else {
                    OnboardingView(environment: environment)
                }
            }
            .overlay {
                if environment.profile.isOnboarded, environment.lock.isLocked {
                    LockScreen(lock: environment.lock) { Task { await environment.forgotPasscode() } }
                        .transition(.opacity)
                } else if environment.lock.isEnabled, scenePhase != .active {
                    PrivacyCover()
                }
            }
            .animation(.easeInOut(duration: 0.3), value: environment.profile.isOnboarded)
            .animation(.easeInOut(duration: 0.2), value: environment.lock.isLocked)
            .environment(environment)
            .preferredColorScheme(.dark)
            .task { environment.lock.launched() }
            .onChange(of: scenePhase) { _, phase in
                switch phase {
                case .background: environment.lock.movedToBackground()
                case .active:
                    environment.lock.cameToForeground()
                    Task {
                        await environment.refreshVault()
                        await environment.refreshActivity()
                    }
                default: break
                }
            }
        }
    }
}
