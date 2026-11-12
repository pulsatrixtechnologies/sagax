// #3992: a short chat on iPad went blank a few seconds after it opened.
// The numbers are the ones the DEBUG store preview showed on an iPad Pro
// 11 simulator: a 294 pt transcript in a 1148 pt scroll view, bottom
// aligned by an 854 pt top inset, its offset left at -1652 by a scroll to
// the bottom computed on estimated row heights.
import CoreGraphics
import XCTest
@testable import CompanionCore

final class TranscriptScrollPinTests: XCTestCase {
    private func short(offset: CGFloat) -> TranscriptScrollGeometry {
        TranscriptScrollGeometry(offsetY: offset, contentHeight: 294, boundsHeight: 1148, insetTop: 854, insetBottom: 0)
    }

    private func long(offset: CGFloat) -> TranscriptScrollGeometry {
        TranscriptScrollGeometry(offsetY: offset, contentHeight: 5000, boundsHeight: 1148, insetTop: 56, insetBottom: 0)
    }

    func testShortTranscriptRestsWhereSwiftUIBottomAlignsIt() {
        let geometry = short(offset: -854)
        XCTAssertEqual(geometry.endOffset, -854)
        XCTAssertFalse(geometry.showsNoContent)
        XCTAssertNil(TranscriptScrollPin.followOffset(geometry, userScrolling: false))
        XCTAssertNil(TranscriptScrollPin.blankRescueOffset(geometry, userScrolling: false))
    }

    func testShortTranscriptPushedBelowTheScreenComesBack() {
        let blank = short(offset: -1652)
        XCTAssertTrue(blank.showsNoContent)
        XCTAssertEqual(TranscriptScrollPin.blankRescueOffset(blank, userScrolling: false), -854)
        // the follow pin no longer skips a transcript shorter than the screen
        XCTAssertEqual(TranscriptScrollPin.followOffset(blank, userScrolling: false), -854)
    }

    func testReaderPullingIsLeftAlone() {
        XCTAssertNil(TranscriptScrollPin.blankRescueOffset(short(offset: -1652), userScrolling: true))
        XCTAssertNil(TranscriptScrollPin.followOffset(short(offset: -1652), userScrolling: true))
    }

    func testLongTranscriptFollowsItsNewestRow() {
        let geometry = long(offset: 1200)
        XCTAssertEqual(geometry.endOffset, 5000 - 1148)
        XCTAssertEqual(TranscriptScrollPin.followOffset(geometry, userScrolling: false), 3852)
        XCTAssertNil(TranscriptScrollPin.followOffset(long(offset: 3852), userScrolling: false))
    }

    func testLongTranscriptReadMidThreadIsNotMoved() {
        XCTAssertNil(TranscriptScrollPin.blankRescueOffset(long(offset: 1200), userScrolling: false))
    }

    func testLongTranscriptPastEitherEndComesToTheNearestEdge() {
        XCTAssertEqual(TranscriptScrollPin.blankRescueOffset(long(offset: 6000), userScrolling: false), 3852)
        XCTAssertEqual(TranscriptScrollPin.blankRescueOffset(long(offset: -1300), userScrolling: false), -56)
    }

    func testContentShrinkingUnderAnOffsetComesBackToTheEnd() {
        // estimated rows made the stack 4000 pt; the drawn rows are 600 pt
        let shrunk = TranscriptScrollGeometry(offsetY: 2852, contentHeight: 600, boundsHeight: 1148, insetTop: 548, insetBottom: 0)
        XCTAssertTrue(shrunk.showsNoContent)
        XCTAssertEqual(TranscriptScrollPin.blankRescueOffset(shrunk, userScrolling: false), -548)
    }
}
