import SwiftUI
import UIKit

/// The app's icons: Hugeicons Stroke Rounded (MIT), kept as template vectors in Assets/Icons and named after the
/// SF Symbol each one replaces, so `Icon("paperplane")` reads like the symbol it was. A name without a Hugeicons
/// asset falls back to the SF Symbol rather than rendering nothing.
struct Icon: View {
    let name: String
    var size: CGFloat

    init(_ name: String, size: CGFloat = 20) {
        self.name = name
        self.size = size
    }

    var body: some View {
        if let asset = Self.asset(for: name) {
            Image(asset)
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
                .frame(width: size, height: size)
        } else {
            Image(systemName: name)
                .font(.system(size: size * 0.8))
                .frame(width: size, height: size)
        }
    }

    static func asset(for name: String) -> String? {
        let asset = "icon-" + name.replacingOccurrences(of: ".", with: "-")
        return UIImage(named: asset) == nil ? nil : asset
    }
}

/// A label whose icon is an `Icon`, for buttons and chips.
struct IconLabel: View {
    let title: String
    let icon: String
    var size: CGFloat = 18

    init(_ title: String, icon: String, size: CGFloat = 18) {
        self.title = title
        self.icon = icon
        self.size = size
    }

    var body: some View {
        Label {
            Text(title)
        } icon: {
            Icon(icon, size: size)
        }
    }
}

/// The keypad's delete key, drawn in the same 1.5 point rounded stroke as Hugeicons, which has no backspace glyph.
struct BackspaceGlyph: View {
    var size: CGFloat = 26

    var body: some View {
        Canvas { context, canvas in
            let unit = canvas.width / 24
            var body = Path()
            body.move(to: CGPoint(x: 8.5 * unit, y: 5 * unit))
            body.addLine(to: CGPoint(x: 19 * unit, y: 5 * unit))
            body.addQuadCurve(to: CGPoint(x: 21.5 * unit, y: 7.5 * unit), control: CGPoint(x: 21.5 * unit, y: 5 * unit))
            body.addLine(to: CGPoint(x: 21.5 * unit, y: 16.5 * unit))
            body.addQuadCurve(to: CGPoint(x: 19 * unit, y: 19 * unit), control: CGPoint(x: 21.5 * unit, y: 19 * unit))
            body.addLine(to: CGPoint(x: 8.5 * unit, y: 19 * unit))
            body.addLine(to: CGPoint(x: 2.5 * unit, y: 12 * unit))
            body.closeSubpath()
            var cross = Path()
            cross.move(to: CGPoint(x: 11.5 * unit, y: 9.5 * unit))
            cross.addLine(to: CGPoint(x: 16.5 * unit, y: 14.5 * unit))
            cross.move(to: CGPoint(x: 16.5 * unit, y: 9.5 * unit))
            cross.addLine(to: CGPoint(x: 11.5 * unit, y: 14.5 * unit))
            let style = StrokeStyle(lineWidth: 1.5 * unit, lineCap: .round, lineJoin: .round)
            context.stroke(body, with: .foreground, style: style)
            context.stroke(cross, with: .foreground, style: style)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
