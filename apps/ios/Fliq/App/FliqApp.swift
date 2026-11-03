import SwiftUI

@main
struct FliqApp: App {
    private let api = AppConfig.makeAPI()

    var body: some Scene {
        WindowGroup {
            HomeView(model: HomeModel(api: api))
                .preferredColorScheme(.dark)
        }
    }
}
