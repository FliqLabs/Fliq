import SwiftUI

struct PersonPayView: View {
    @Bindable var flow: PersonPayFlow
    let onDone: () -> Void
    @FocusState private var nameFocused: Bool

    var body: some View {
        Group {
            if let paid = flow.paid, let person = flow.person {
                done(paid, to: person)
            } else {
                paying
            }
        }
        .fliqScreen("Pay a fliq user", aurora: Aurora(strength: 0.55))
    }

    private var paying: some View {
        VStack(spacing: 0) {
            nameField.padding(.top, 20)
            whoLine.frame(height: 44).padding(.top, 8)
            Spacer(minLength: 8)
            ViewThatFits(in: .vertical) {
                amount
                compactAmount
            }
            .contentShape(Rectangle())
            .onTapGesture { nameFocused = false }
            Spacer(minLength: 8)
            if !nameFocused {
                AmountKeypad(text: flow.amountText, onType: flow.enterAmount)
                    .padding(.bottom, 8)
            }
            if let message = flow.errorMessage {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 8)
            }
            Button { Task { await flow.pay() } } label: {
                if flow.isSending {
                    ProgressView().tint(.black)
                } else {
                    IconLabel("Pay $\(Money.dollars(flow.amount ?? .zero)) with Face ID", icon: "faceid")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!flow.canPay)
            .padding(.bottom, 12)
        }
        .task(id: flow.nameText) { await flow.lookUp() }
        .onAppear { if flow.nameText.isEmpty { nameFocused = true } }
    }

    private var compactAmount: some View {
        VStack(spacing: 4) {
            HeroAmount(symbol: "$", value: Money.dollars(flow.amount ?? .zero), size: 48)
            Text("\(receives) · in your vault $\(Money.dollars(flow.available))")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    private var amount: some View {
        VStack(spacing: 12) {
            Text(receives)
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
            HeroAmount(symbol: "$", value: Money.dollars(flow.amount ?? .zero))
            IconLabel("Vault to vault · instant · no fee", icon: "bolt")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, 16)
                .frame(height: 40)
                .overlay(Capsule().strokeBorder(Theme.hairline))
            Text("In your vault $\(Money.dollars(flow.available))")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textTertiary)
                .padding(.top, 4)
        }
    }

    private var nameField: some View {
        HStack(spacing: 12) {
            Text("@")
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
            TextField("name", text: $flow.nameText)
                .focused($nameFocused)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .submitLabel(.next)
                .onSubmit { nameFocused = false }
                .font(.system(size: 19, weight: .medium))
        }
        .padding(.horizontal, 18)
        .frame(height: 60)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16).strokeBorder(flow.person == nil ? Theme.hairline : Theme.confirmed)
        }
    }

    @ViewBuilder
    private var whoLine: some View {
        HStack(spacing: 10) {
            if let person = flow.person {
                PersonAvatar(name: person.displayName ?? FliqName.display(person.nearAccount), photoURL: person.photoUrl.flatMap(URL.init(string:)), size: 32)
                Icon("checkmark.circle", size: 18).foregroundStyle(Theme.confirmed)
                Text(person.displayName ?? FliqName.display(person.nearAccount)).fontWeight(.semibold).foregroundStyle(Theme.confirmed)
                Text("· on fliq since \(person.memberSince.formatted(.dateTime.month(.abbreviated).year()))")
                    .foregroundStyle(Theme.textSecondary)
            } else if flow.isLookingUp {
                ProgressView().controlSize(.small)
                Text("Finding \(flow.account.map(FliqName.display) ?? "")").foregroundStyle(Theme.textSecondary)
            } else if flow.lookupFailed {
                Icon("questionmark.circle", size: 18).foregroundStyle(Theme.warning)
                Text("No one on fliq has that name").foregroundStyle(Theme.warning)
            }
            Spacer()
        }
        .font(.system(size: 15))
        .lineLimit(1)
        .padding(.horizontal, 4)
    }

    private func done(_ paid: TokenAmount, to person: Person) -> some View {
        VStack(spacing: 14) {
            Spacer()
            ZStack(alignment: .bottomTrailing) {
                PersonAvatar(name: person.displayName ?? person.nearAccount, photoURL: person.photoUrl.flatMap(URL.init(string:)), size: 76)
                    .padding(flow.isConfirmed ? 0 : 6)
                    .overlay { if !flow.isConfirmed { SpinningRing() } }
                if flow.isConfirmed {
                    Icon("checkmark", size: 14)
                        .foregroundStyle(.black)
                        .frame(width: 28, height: 28)
                        .background(Theme.confirmed, in: Circle())
                        .overlay(Circle().strokeBorder(Theme.ground, lineWidth: 3))
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(.spring(duration: 0.4), value: flow.isConfirmed)
            HeroAmount(symbol: "$", value: Money.dollars(paid))
            Text("\(flow.isConfirmed ? "Paid to" : "Paying") \(person.displayName ?? FliqName.display(person.nearAccount))")
                .font(.system(size: 16))
                .foregroundStyle(Theme.textSecondary)
            Text(FliqName.display(person.nearAccount))
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(Theme.textTertiary)
            Spacer()
            Button("Done", action: onDone)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.bottom, 12)
        }
    }

    private var receives: String {
        guard let first = flow.person?.displayName?.split(separator: " ").first else { return "They receive" }
        return "\(first) receives"
    }
}

#Preview {
    NavigationStack {
        PersonPayView(flow: PersonPayFlow(api: FixtureClient(), transfers: FixtureVaultTransfers(), account: "tobi.fliq.near"), onDone: {})
    }
    .environment(AppEnvironment.preview)
}
