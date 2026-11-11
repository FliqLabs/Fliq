import SwiftUI

struct AccountsView: View {
    let onAdd: () -> Void
    @Environment(AppEnvironment.self) private var environment

    private var book: AccountBook { environment.accounts }

    var body: some View {
        List {
            Section {
                if let own = book.own {
                    row(own, badge: "Default")
                } else {
                    Text("Add your own account so cashing out is one tap.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.vertical, 6)
                        .listRowBackground(RoundedRectangle(cornerRadius: 14).fill(Theme.surface))
                        .listRowSeparator(.hidden)
                }
            } header: {
                SectionLabel(text: "Yours").padding(.top, 8)
            }

            Section {
                if book.saved.isEmpty {
                    Text("Accounts you pay with \"Save this account\" on show up here.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.vertical, 6)
                        .listRowBackground(RoundedRectangle(cornerRadius: 14).fill(Theme.surface))
                        .listRowSeparator(.hidden)
                } else {
                    ForEach(book.saved, id: \.number) { account in
                        row(account, badge: nil)
                            .swipeActions(edge: .trailing) {
                                Button("Remove", role: .destructive) { book.remove(account) }
                                    .tint(Color(hex: 0xB4332C))
                            }
                    }
                }
            } header: {
                SectionLabel(text: "Saved")
            }
        }
        .listStyle(.plain)
        .listRowSpacing(8)
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .bottom) {
            HStack {
                Spacer()
                Button(action: onAdd) {
                    IconLabel("Add account", icon: "plus")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 18)
                        .frame(height: 50)
                        .background(.white, in: Capsule())
                        .shadow(color: .black.opacity(0.5), radius: 15, y: 10)
                }
            }
            .padding(.bottom, 12)
        }
        .fliqScreen("Your accounts")
    }

    private func row(_ account: VerifiedAccount, badge: String?) -> some View {
        HStack(spacing: 14) {
            Text(String(account.accountName.prefix(1)))
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 38, height: 38)
                .background(Theme.surfaceRaised, in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(account.accountName).font(.system(size: 15, weight: .medium))
                Text("\(account.institution) ···\(account.number.suffix(4)) · Nigeria")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            if let badge {
                Text(badge)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, 9)
                    .frame(height: 24)
                    .background(Color(hex: 0x262626), in: Capsule())
            }
        }
        .frame(height: 66)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        .listRowBackground(RoundedRectangle(cornerRadius: 14).fill(Theme.surface))
        .listRowSeparator(.hidden)
        .foregroundStyle(Theme.textPrimary)
    }
}
