import SwiftUI
import UIKit

/// A bank or mobile money logo from `logo_key`, or its initials when the app ships no logo for it.
struct InstitutionLogo: View {
    let logoKey: String?
    let name: String
    var size: CGFloat = 32

    var body: some View {
        Group {
            if let image = logoKey.flatMap({ UIImage(named: "Bank-\($0)") }) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Text(initials)
                    .font(.system(size: size * 0.36, weight: .bold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initials: String {
        String(name.split(separator: " ").prefix(2).compactMap(\.first)).uppercased()
    }
}

/// A round flag for a payout country.
struct CountryFlag: View {
    let country: Country
    var size: CGFloat = 22

    var body: some View {
        Text(country.flag)
            .font(.system(size: size * 1.9))
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5))
    }
}

/// A person or account holder: their photo, or their initial on a colour picked from their name.
struct PersonAvatar: View {
    let name: String
    var photoURL: URL?
    var size: CGFloat = 44

    var body: some View {
        Group {
            if let photoURL {
                AsyncImage(url: photoURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initial
                }
            } else {
                initial
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initial: some View {
        Text(initials)
            .font(.system(size: size * 0.34, weight: .semibold))
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(tint.opacity(0.16))
            .background(Theme.surfaceRaised)
    }

    private var initials: String {
        let words = name.split(whereSeparator: { $0 == " " || $0 == "." }).filter { $0.first?.isLetter == true }
        return String(words.prefix(2).compactMap(\.first)).uppercased()
    }

    /// A soft tint picked from the name, so the same person always gets the same colour.
    private var tint: Color {
        let palette: [Color] = [Color(hex: 0xF2A36B), Color(hex: 0x8FB4FF), Color(hex: 0x6FD3A8), Color(hex: 0xC9A6FF), Color(hex: 0xF28B9B), Color(hex: 0xE8D27A)]
        let index = name.unicodeScalars.reduce(0) { ($0 + Int($1.value)) % palette.count }
        return palette[index]
    }
}

/// An avatar with a small badge in its corner: the bank logo, or the NEAR mark for a fliq user.
struct BadgedAvatar<Badge: View>: View {
    let avatar: PersonAvatar
    @ViewBuilder let badge: Badge

    var body: some View {
        avatar.overlay(alignment: .bottomTrailing) {
            badge
                .frame(width: 20, height: 20)
                .background(Circle().fill(Theme.surface).padding(-2))
                .offset(x: 2, y: 2)
        }
    }
}

/// The NEAR "N" in NEAR green, for fliq users and vault-to-vault payments.
struct NEARMark: View {
    var size: CGFloat = 14

    var body: some View {
        Image("NearLogo")
            .resizable()
            .renderingMode(.template)
            .scaledToFit()
            .frame(width: size, height: size)
            .foregroundStyle(Color(hex: 0x00EC97))
    }
}
