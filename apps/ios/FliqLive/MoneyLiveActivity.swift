import ActivityKit
import SwiftUI
import WidgetKit

struct MoneyLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MoneyActivityAttributes.self) { context in
            LockScreenCard(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "fliq://activity"))
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.title)
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                        Text(context.attributes.amount)
                            .font(.system(size: 26, weight: .bold))
                            .monospacedDigit()
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    StatusLabel(state: state)
                        .padding(.trailing, 4)
                        .frame(maxHeight: .infinity, alignment: .top)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Route(from: context.attributes.from, to: context.attributes.to, state: state)
                        .padding(.horizontal, 4)
                        .padding(.top, 6)
                }
            } compactLeading: {
                Image("FliqMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 22, height: 22)
            } compactTrailing: {
                if state.done || state.failed {
                    StatusIcon(state: state)
                } else {
                    Text(context.attributes.amount)
                        .font(.system(size: 14, weight: .semibold))
                        .monospacedDigit()
                }
            } minimal: {
                ProgressRing(state: state)
            }
            .keylineTint(LiveColors.tint(state))
            .widgetURL(URL(string: "fliq://activity"))
        }
    }
}

private enum LiveColors {
    static let confirmed = Color(red: 0.2, green: 0.84, blue: 0.47)
    static let failed = Color(red: 1, green: 0.42, blue: 0.38)
    static let track = Color.white.opacity(0.22)

    static func tint(_ state: MoneyActivityAttributes.ContentState) -> Color {
        if state.failed { return failed }
        if state.done { return confirmed }
        return .white
    }
}

private struct LockScreenCard: View {
    let attributes: MoneyActivityAttributes
    let state: MoneyActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(attributes.title)
                    .font(.system(size: 15))
                    .foregroundStyle(.white.opacity(0.6))
                Spacer()
                StatusLabel(state: state)
            }
            Text(attributes.amount)
                .font(.system(size: 36, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(.white)
                .contentTransition(.numericText())
            Route(from: attributes.from, to: attributes.to, state: state)
        }
        .padding(18)
    }
}

private struct StatusLabel: View {
    let state: MoneyActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 6) {
            StatusIcon(state: state)
            Text(state.status)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }
}

private struct StatusIcon: View {
    let state: MoneyActivityAttributes.ContentState

    var body: some View {
        if state.failed {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(LiveColors.failed)
        } else if state.done {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(LiveColors.confirmed)
        } else {
            ProgressRing(state: state)
                .frame(width: 16, height: 16)
        }
    }
}

private struct ProgressRing: View {
    let state: MoneyActivityAttributes.ContentState

    var body: some View {
        ZStack {
            Circle().stroke(LiveColors.track, lineWidth: 2.5)
            Circle()
                .trim(from: 0, to: max(0.08, state.progress))
                .stroke(LiveColors.tint(state), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .padding(2)
    }
}

/// From, a line that fills as the money moves, then to: the Talise-style route row.
private struct Route: View {
    let from: String
    let to: String
    let state: MoneyActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 10) {
            Text(from)
                .lineLimit(1)
                .layoutPriority(1)
            GeometryReader { proxy in
                let filled = proxy.size.width * state.progress
                ZStack(alignment: .leading) {
                    Capsule().fill(LiveColors.track).frame(height: 2)
                    Capsule().fill(LiveColors.tint(state)).frame(width: filled, height: 2)
                    Circle()
                        .fill(LiveColors.tint(state))
                        .frame(width: 7, height: 7)
                        .offset(x: max(0, filled - 3.5))
                }
                .frame(maxHeight: .infinity)
            }
            .frame(minWidth: 40, maxHeight: 12)
            Text(to)
                .lineLimit(1)
                .layoutPriority(2)
        }
        .font(.system(size: 14))
        .foregroundStyle(.white.opacity(0.9))
    }
}
