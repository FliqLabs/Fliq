import SwiftUI

struct ActivityView: View {
    let store: ActivityStore
    let onReceive: () -> Void
    var onRefresh: () async -> Void = {}
    var onOpenReceipt: (String) -> Void = { _ in }
    @State private var filter = Filter.all
    @State private var selected: ActivityLine?

    enum Filter: String, CaseIterable {
        case all = "All", mine = "Mine", agents = "Agents"
    }

    var body: some View {
        VStack(spacing: 0) {
            Text("Activity")
                .font(.system(size: 26, weight: .bold))
                .tracking(-0.52)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 20)
            HStack(spacing: 8) {
                ForEach(Filter.allCases, id: \.self) { option in
                    Button(option.rawValue) { filter = option }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(filter == option ? .black : Theme.textSecondary)
                        .padding(.horizontal, 16)
                        .frame(height: 34)
                        .background(filter == option ? Color.white : Theme.field, in: Capsule())
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 14)

            GeometryReader { proxy in
                ScrollView {
                    if shown.isEmpty {
                        empty.frame(minHeight: proxy.size.height)
                    } else {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(days, id: \.title) { day in
                                Text(day.title)
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textSecondary)
                                    .padding(.top, 14)
                                    .padding(.horizontal, 2)
                                ForEach(day.lines) { line in
                                    Button { selected = line } label: { ActivityCell(line: line) }
                                        .buttonStyle(.pressable(scale: 0.98))
                                }
                            }
                        }
                        .padding(.top, 8)
                        .padding(.bottom, 24)
                    }
                }
                .scrollIndicators(.hidden)
                .refreshable { await onRefresh() }
            }
        }
        .task { await onRefresh() }
        .sheet(item: $selected) { line in
            ActivityDetailSheet(line: line, onReceipt: onOpenReceipt)
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(32)
                .presentationBackground(Color(hex: 0x161616))
        }
    }

    private var empty: some View {
        VStack(spacing: 14) {
            Spacer()
            Icon("clock.arrow.circlepath", size: 29)
                .foregroundStyle(Theme.textTertiary)
                .frame(width: 64, height: 64)
                .background(Theme.surface, in: Circle())
            Text("Nothing yet").font(.system(size: 17, weight: .semibold))
            Text("Your first receipt lands here.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Button("Receive", action: onReceive)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.bottom, 12)
        }
    }

    private var shown: [ActivityLine] {
        store.lines.filter { line in
            switch filter {
            case .all: true
            case .mine: !line.isAgent
            case .agents: line.isAgent
            }
        }
    }

    private var days: [(title: String, lines: [ActivityLine])] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: shown) { calendar.startOfDay(for: $0.date) }
        return grouped.keys.sorted(by: >).map { day in
            let title = calendar.isDateInToday(day) ? "Today"
                : calendar.isDateInYesterday(day) ? "Yesterday"
                : day.formatted(date: .abbreviated, time: .omitted)
            return (title, grouped[day] ?? [])
        }
    }
}
