import SwiftUI

@main
struct FliqApp: App {
    @State private var environment = AppEnvironment.live()

    var body: some Scene {
        WindowGroup {
            Group {
                if environment.profile.isOnboarded {
                    RootView()
                } else {
                    OnboardingView(environment: environment)
                }
            }
            .animation(.easeInOut(duration: 0.3), value: environment.profile.isOnboarded)
            .environment(environment)
            .preferredColorScheme(.dark)
        }
    }
}
