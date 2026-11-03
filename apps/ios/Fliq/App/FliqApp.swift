import SwiftUI

@main
struct FliqApp: App {
    @State private var environment = AppEnvironment.live()

    var body: some Scene {
        WindowGroup {
            HomeView(model: HomeModel(api: environment.api))
                .environment(environment)
                .preferredColorScheme(.dark)
        }
    }
}
