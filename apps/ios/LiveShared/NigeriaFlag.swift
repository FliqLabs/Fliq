import SwiftUI

/// Money from a Nigerian bank, drawn rather than shipped as an image so the app and the Live Activity share it.
struct NigeriaFlag: View {
    var size: CGFloat = 32

    var body: some View {
        HStack(spacing: 0) {
            Self.green
            Color.white
            Self.green
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1))
    }

    private static let green = Color(red: 0, green: 0.53, blue: 0.32)
}
