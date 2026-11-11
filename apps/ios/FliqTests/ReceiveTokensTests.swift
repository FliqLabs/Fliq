import XCTest
@testable import Fliq

@MainActor
final class ReceiveTokensTests: XCTestCase {
    private func makeModel(api: any DepositAPI = FixtureDepositAPI(), network: NearNetwork = .mainnet) async -> ReceiveTokensModel {
        let flow = ReceiveFlow(api: api, vault: VaultStore(), vaultAccount: "frank.fliqaccount.testnet", name: "frank.fliqaccount.testnet", network: network)
        let model = ReceiveTokensModel(flow: flow)
        await model.load()
        return model
    }

    func testUSDCOnNEARIsTheDefaultOnMainnet() async throws {
        let model = await makeModel()
        XCTAssertEqual(model.token, "usdc")
        XCTAssertEqual(model.source?.chainId, "near")
        XCTAssertEqual(model.address?.address, "frank.fliqaccount.testnet")
        XCTAssertEqual(model.tokens.first, "usdc")
        XCTAssertTrue(model.canPickToken)
        XCTAssertTrue(model.canPickNetwork)
        XCTAssertEqual(model.networks.first?.chainId, "near", "NEAR leads the network list")
    }

    func testTestnetHasOneOptionAndNothingToPick() async {
        let model = await makeModel(network: .testnet)
        XCTAssertEqual(model.tokens, ["usdc"])
        XCTAssertEqual(model.networks.map(\.chainId), ["near"])
        XCTAssertFalse(model.canPickToken)
        XCTAssertFalse(model.canPickNetwork)
        XCTAssertEqual(model.address?.address, "frank.fliqaccount.testnet")
    }

    func testChangingTheTokenResetsTheNetwork() async {
        let model = await makeModel()
        await model.pick(token: "usdt")
        XCTAssertEqual(model.source?.chainId, "tron")
        XCTAssertEqual(model.address?.source.chainId, "tron")
        await model.pick(token: "usdc")
        XCTAssertEqual(model.source?.chainId, "near")
    }

    func testPickingANetworkReservesItsOwnAddress() async throws {
        let model = await makeModel()
        let solana = try XCTUnwrap(model.networks.first { $0.chainId == "solana" })
        await model.pick(network: solana)
        XCTAssertEqual(model.address?.source, solana)
        XCTAssertNotEqual(model.address?.address, "frank.fliqaccount.testnet")
    }

    func testAnExpiredAddressIsReservedAgainAndALiveOneIsKept() async throws {
        let api = CountingAPI()
        let model = await makeModel(api: api)
        let solana = try XCTUnwrap(model.networks.first { $0.chainId == "solana" })
        await model.pick(network: solana)
        let afterPick = await api.count
        let until = try XCTUnwrap(model.address?.reservedUntil)

        await model.reserveIfNeeded(at: until.addingTimeInterval(-60))
        let whileLive = await api.count
        XCTAssertEqual(whileLive, afterPick, "A live address is kept")

        await model.reserveIfNeeded(at: until.addingTimeInterval(1))
        let afterExpiry = await api.count
        XCTAssertEqual(afterExpiry, afterPick + 1, "An expired address is reserved again")
    }

    func testANetworkTheServerRefusesFallsBackToNEAR() async throws {
        let model = await makeModel(api: RefusingOtherChains())
        let solana = try XCTUnwrap(model.networks.first { $0.chainId == "solana" })
        await model.pick(network: solana)
        XCTAssertEqual(model.source?.chainId, "near")
        XCTAssertFalse(model.networks.contains(solana), "The refused network leaves the dropdown")
    }

    func testLongAddressesKeepBothEnds() {
        XCTAssertEqual(ReceiveTokensModel.shortened("HYC7S2nPphRCFYNtnuxyV3RA1z9JwnkDwCr1V9wz"), "HYC7S2…r1V9wz")
        XCTAssertEqual(ReceiveTokensModel.shortened("frank.near"), "frank.near")
        XCTAssertEqual(ReceiveTokensModel.shortened("frank.fliqaccount.testnet"), "frank.fliqaccount.testnet", "NEAR names stay whole")
    }

    private actor Counter {
        var value = 0
        func bump() { value += 1 }
    }

    private final class CountingAPI: DepositAPI {
        private let counter = Counter()
        var count: Int { get async { await counter.value } }
        func sources() async throws -> [DepositSource] { try await FixtureDepositAPI().sources() }
        func reserve(_ source: DepositSource, vault: String) async throws -> DepositAddress {
            await counter.bump()
            return try await FixtureDepositAPI().reserve(source, vault: vault)
        }
        func status(of deposit: DepositAddress) async throws -> DepositStatus { throw DepositUnavailable(message: "") }
    }

    private struct RefusingOtherChains: DepositAPI {
        func sources() async throws -> [DepositSource] { try await FixtureDepositAPI().sources() }
        func reserve(_ source: DepositSource, vault: String) async throws -> DepositAddress {
            guard source.isDirect else { throw DepositUnavailable(message: "Not available right now.") }
            return try await FixtureDepositAPI().reserve(source, vault: vault)
        }
        func status(of deposit: DepositAddress) async throws -> DepositStatus { throw DepositUnavailable(message: "") }
    }
}
