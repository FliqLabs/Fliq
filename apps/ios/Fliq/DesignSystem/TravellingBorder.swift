import SwiftUI

/// The capsule outline with a comet that circles it every 2.6s, ported from Desk's name field.
struct TravellingBorder: View {
    let tint: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Capsule().stroke(tint.opacity(0.35), lineWidth: 1.2)
            if !reduceMotion {
                TimelineView(.animation) { context in
                    let turn = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.6) / 2.6
                    Capsule()
                        .stroke(
                            AngularGradient(
                                stops: [
                                    .init(color: .clear, location: 0),
                                    .init(color: .clear, location: 0.62),
                                    .init(color: tint.opacity(0.9), location: 0.86),
                                    .init(color: .white, location: 0.97),
                                    .init(color: .clear, location: 1),
                                ],
                                center: .center,
                                angle: .degrees(turn * 360)
                            ),
                            lineWidth: 1.8
                        )
                        .blur(radius: 0.3)
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
