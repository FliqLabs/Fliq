import SwiftUI

/// The Welcome screen's glass ribbons and orbit ring, drawn as vectors so they stay sharp at any
/// resolution. Coordinates are App v5's 390pt frame and scale with the screen width.
struct WelcomeBackdrop: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var arrived = false

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            let seconds = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
            Canvas { context, size in
                WelcomeBackdropDrawing(seconds: seconds).draw(in: &context, size: size)
            }
        }
        .scaleEffect(arrived ? 1 : 1.08, anchor: .top)
        .blur(radius: arrived ? 0 : 24)
        .opacity(arrived ? 1 : 0)
        .background(ground)
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear {
            guard !reduceMotion else { return arrived = true }
            withAnimation(.easeOut(duration: 1.2)) { arrived = true }
        }
    }

    private var ground: some View {
        LinearGradient(
            stops: [
                .init(color: Color(hex: 0x16161C), location: 0),
                .init(color: Color(hex: 0x0A0A0C), location: 0.5),
                .init(color: .black, location: 1),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

private struct WelcomeBackdropDrawing {
    let seconds: Double

    private static let designWidth: CGFloat = 390
    private static let driftPeriod = 14.0
    private static let cometPeriod = 8.0
    private static let orbitCenter = CGPoint(x: 195, y: 222)

    func draw(in context: inout GraphicsContext, size: CGSize) {
        let scale = size.width / Self.designWidth
        context.scaleBy(x: scale, y: scale)

        let drift = sin(seconds / Self.driftPeriod * 2 * .pi)
        let sway = cos(seconds / (Self.driftPeriod * 1.3) * 2 * .pi)

        var ribbons = context
        ribbons.translateBy(x: Self.orbitCenter.x, y: Self.orbitCenter.y)
        ribbons.rotate(by: .degrees(2.5 * drift))
        ribbons.translateBy(x: -Self.orbitCenter.x, y: -Self.orbitCenter.y)
        drawRibbons(in: &ribbons, drift: drift, sway: sway)

        let height = size.height / scale
        drawFade(in: &context, height: height)
        drawOrbit(in: &context)
    }

    private func drawRibbons(in context: inout GraphicsContext, drift: Double, sway: Double) {
        let lift = CGFloat(6 * drift)
        let lean = CGFloat(8 * sway)

        let rising = curve(
            CGPoint(x: 26, y: 400), CGPoint(x: 66 + lean, y: 255),
            CGPoint(x: 112 - lean, y: 105 + lift), CGPoint(x: 170, y: -40)
        )
        tube(rising, in: &context, width: 80, from: CGPoint(x: 26, y: 400), to: CGPoint(x: 170, y: -40),
             rim: [0x8D7DFF, 0x3A4BFF, 0x4C5CFF], core: [0x2A1FB8, 0x1626C9, 0x1A2AD8])

        let cyanStop = 0.85 + 0.04 * drift
        let sweeping = curve(
            CGPoint(x: -70, y: 222), CGPoint(x: 80, y: 160 + lift),
            CGPoint(x: 220, y: 88 - lift), CGPoint(x: 335 + lean * 0.5, y: 62)
        )
        tube(sweeping, in: &context, width: 74, from: CGPoint(x: -70, y: 222), to: CGPoint(x: 335, y: 62),
             rim: [0x3A48FF, 0x4A63FF, 0x5FD0F0, 0x8AA0FF], core: [0x1626C9, 0x1D32E0, 0x1F7FD6, 0x2A40E8],
             locations: [0, 0.6, cyanStop, 1])

        let underside = curve(
            CGPoint(x: 338, y: 80), CGPoint(x: 350, y: 112),
            CGPoint(x: 320, y: 142), CGPoint(x: 240, y: 154)
        )
        stroke(underside, in: &context, width: 40, colors: [0x9AA6FF, 0x6C78E8], from: CGPoint(x: 338, y: 80),
               to: CGPoint(x: 240, y: 154), blur: 12, opacity: 0.3)
    }

    private func tube(
        _ path: Path, in context: inout GraphicsContext, width: CGFloat, from: CGPoint, to: CGPoint,
        rim: [UInt32], core: [UInt32], locations: [Double]? = nil
    ) {
        stroke(path, in: &context, width: width, colors: rim, from: from, to: to, blur: 9, opacity: 0.5, locations: locations)
        stroke(path, in: &context, width: width * 0.72, colors: core, from: from, to: to, blur: 11, opacity: 0.72, locations: locations)
    }

    private func stroke(
        _ path: Path, in context: inout GraphicsContext, width: CGFloat, colors: [UInt32], from: CGPoint,
        to: CGPoint, blur: CGFloat, opacity: Double, locations: [Double]? = nil
    ) {
        context.drawLayer { layer in
            layer.addFilter(.blur(radius: blur))
            layer.opacity = opacity
            let stops = colors.enumerated().map { index, hex in
                Gradient.Stop(
                    color: Color(hex: hex),
                    location: locations?[index] ?? Double(index) / Double(max(1, colors.count - 1))
                )
            }
            layer.stroke(
                path,
                with: .linearGradient(Gradient(stops: stops), startPoint: from, endPoint: to),
                style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round)
            )
        }
    }

    private func drawFade(in context: inout GraphicsContext, height: CGFloat) {
        let fade = Gradient(stops: [
            .init(color: .clear, location: 0),
            .init(color: .clear, location: 0.45),
            .init(color: .black.opacity(0.85), location: 0.56),
            .init(color: .black, location: 0.66),
        ])
        context.fill(
            Path(CGRect(x: -40, y: 0, width: Self.designWidth + 80, height: height)),
            with: .linearGradient(fade, startPoint: .zero, endPoint: CGPoint(x: 0, y: height))
        )
    }

    private func drawOrbit(in context: inout GraphicsContext) {
        let ring = Path(ellipseIn: CGRect(x: -262, y: -158, width: 524, height: 316))
            .applying(CGAffineTransform(rotationAngle: -0.03))
            .applying(CGAffineTransform(translationX: Self.orbitCenter.x, y: Self.orbitCenter.y))
        context.stroke(ring, with: .color(.white.opacity(0.22)), lineWidth: 1)

        let head = (seconds / Self.cometPeriod).truncatingRemainder(dividingBy: 1)
        let length = 0.1
        context.drawLayer { comet in
            comet.addFilter(.blur(radius: 1.2))
            for (start, end) in segments(from: head, length: length) {
                comet.stroke(ring.trimmedPath(from: start, to: end), with: .color(.white.opacity(0.75)), lineWidth: 1.6)
            }
        }
    }

    private func segments(from start: Double, length: Double) -> [(Double, Double)] {
        let end = start + length
        guard end > 1 else { return [(start, end)] }
        return [(start, 1), (0, end - 1)]
    }

    private func curve(_ start: CGPoint, _ control1: CGPoint, _ control2: CGPoint, _ end: CGPoint) -> Path {
        var path = Path()
        path.move(to: start)
        path.addCurve(to: end, control1: control1, control2: control2)
        return path
    }
}

#Preview {
    WelcomeBackdrop()
}
