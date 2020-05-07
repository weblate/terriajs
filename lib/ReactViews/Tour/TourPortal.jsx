/**
 * TourPortal.jsx
 * Framework for tour
 *
 * Not a real "portal" in the sense of a react portal, even though it
 * started out as wanting to be that. Our not-yet-invented "new modal system"
 * will probably utilise a react portal, though.
 *
 * TODO: loop through configparameters for ability to customise at runtime
 * , then add docs for customisation
 */
import React, { useEffect } from "react";
import { withTheme, useTheme } from "styled-components";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { autorun } from "mobx";
import { observer } from "mobx-react";

import Caret from "../Generic/Caret";
import CloseButton from "../Generic/CloseButton";
import Box from "../../Styled/Box";
import Spacing from "../../Styled/Spacing";
import Button, { RawButton } from "../../Styled/Button";
import Text from "../../Styled/Text";
import parseCustomMarkdownToReact from "../Custom/parseCustomMarkdownToReact";

import {
  getOffsetsFromTourPoint,
  calculateLeftPosition,
  calculateTopPosition
} from "./tour-helpers.ts";
import TourOverlay from "./TourOverlay.jsx";
import TourProgressDot from "./TourProgressDot.jsx";
import TourIndicator from "./TourIndicator.jsx";
import TourPrefaceBox from "./TourPrefaceBox.jsx";
import TourExplanationBox, {
  TourExplanationBoxZIndex
} from "./TourExplanationBox.jsx";

/**
 * Indicator bar/"dots" on progress of tour.
 * Fill in indicator dot depending on progress determined from count & max count
 */
const TourProgress = ({ max, step, setTourIndex }) => {
  const countArray = Array.from(Array(max).keys()).map(e => e++);
  const countStep = step;
  return (
    <Box centered>
      {countArray.map(count => {
        return (
          <TourProgressDot
            onClick={() => setTourIndex(count)}
            key={count}
            active={count < countStep}
          />
        );
      })}
    </Box>
  );
};
TourProgress.propTypes = {
  setTourIndex: PropTypes.func.isRequired,
  max: PropTypes.number.isRequired,
  step: PropTypes.number.isRequired
};

const TourExplanation = ({
  topStyle,
  leftStyle,
  caretOffsetTop,
  caretOffsetLeft,
  indicatorOffsetTop,
  indicatorOffsetLeft,
  setTourIndex,
  onTourIndicatorClick,
  onPrevious,
  onNext,
  onSkip,
  currentStep,
  maxSteps,
  active,
  isFirstTourPoint,
  isLastTourPoint,
  children
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  if (!active) {
    // Tour explanation requires the various positioning even if only just
    // showing the "tour indicator" button, as it is offset against the caret
    // which is offset against the original box
    return (
      <Box
        positionAbsolute
        style={{
          zIndex: TourExplanationBoxZIndex - 1,
          top: topStyle,
          left: leftStyle
        }}
      >
        <Box
          positionAbsolute
          style={{
            top: `${caretOffsetTop}px`,
            left: `${caretOffsetLeft}px`
          }}
        >
          <TourIndicator
            onClick={onTourIndicatorClick}
            style={{
              top: `${indicatorOffsetTop}px`,
              left: `${indicatorOffsetLeft}px`
            }}
          />
        </Box>
      </Box>
    );
  }
  return (
    <TourExplanationBox
      paddedRatio={3}
      column
      style={{
        top: topStyle,
        left: leftStyle
      }}
    >
      <CloseButton
        color={theme.darkWithOverlay}
        topRight
        onClick={() => onSkip?.()}
      />
      <Spacing bottom={2} />
      <Caret
        style={{
          top: `${caretOffsetTop}px`,
          left: `${caretOffsetLeft}px`
        }}
      />
      <Text light medium textDarker>
        <Text light medium noFontSize textDarker>
          {children}
        </Text>
        <Spacing bottom={3} />
        <Box centered justifySpaceBetween>
          <TourProgress
            setTourIndex={setTourIndex}
            step={currentStep}
            max={maxSteps}
          />
          <Box centered>
            {isLastTourPoint ? (
              <Button onClick={() => onSkip?.()} primary>
                {t("tour.finish")}
              </Button>
            ) : (
              <>
                {!isFirstTourPoint && (
                  <>
                    <RawButton onClick={() => onPrevious?.()}>
                      {t("tour.previous")}
                    </RawButton>
                    <Spacing right={2} />
                  </>
                )}
                <Button onClick={() => onNext?.()} primary>
                  {t("tour.next")}
                </Button>
              </>
            )}
          </Box>
        </Box>
      </Text>
    </TourExplanationBox>
  );
};
TourExplanation.propTypes = {
  children: PropTypes.node.isRequired,
  currentStep: PropTypes.number.isRequired,
  maxSteps: PropTypes.number.isRequired,
  caretOffsetTop: PropTypes.number,
  caretOffsetLeft: PropTypes.number,
  indicatorOffsetTop: PropTypes.number,
  indicatorOffsetLeft: PropTypes.number,
  setTourIndex: PropTypes.func.isRequired,
  onTourIndicatorClick: PropTypes.func.isRequired,
  onPrevious: PropTypes.func.isRequired,
  onNext: PropTypes.func.isRequired,
  onSkip: PropTypes.func.isRequired,
  topStyle: PropTypes.string,
  leftStyle: PropTypes.string,
  isFirstTourPoint: PropTypes.bool.isRequired,
  isLastTourPoint: PropTypes.bool.isRequired,
  active: PropTypes.bool
};

export const TourGrouping = observer(({ viewState, tourPoints }) => {
  const currentTourPoint = tourPoints[viewState.currentTourIndex];
  const currentTourPointRef = viewState.appRefs.get(
    currentTourPoint?.appRefName
  );
  const currentRectangle = currentTourPointRef?.current?.getBoundingClientRect?.();
  if (!currentRectangle) {
    console.log(
      "Tried to show guidance portal with no rectangle available from ref"
    );
  }
  return (
    <>
      {currentRectangle && (
        <TourOverlay
          rectangle={currentRectangle}
          onCancel={() => viewState.nextTourPoint()}
        />
      )}
      {tourPoints.map((tourPoint, index) => {
        const tourPointRef = viewState.appRefs.get(tourPoint?.appRefName);

        const currentRectangle = tourPointRef?.current?.getBoundingClientRect?.();
        const {
          offsetTop,
          offsetLeft,
          caretOffsetTop,
          caretOffsetLeft,
          indicatorOffsetTop,
          indicatorOffsetLeft
        } = getOffsetsFromTourPoint(tourPoint);

        // To match old HelpScreenWindow / HelpOverlay API
        const currentScreen = {
          rectangle: currentRectangle,
          positionTop:
            tourPoint?.positionTop || viewState.relativePosition.RECT_BOTTOM,
          positionLeft:
            tourPoint?.positionLeft || viewState.relativePosition.RECT_LEFT,
          offsetTop: offsetTop,
          offsetLeft: offsetLeft
        };

        const positionLeft = calculateLeftPosition(currentScreen);
        const positionTop = calculateTopPosition(currentScreen);

        const currentTourIndex = viewState.currentTourIndex;
        const maxSteps = tourPoints.length;

        if (!tourPoint) return null;
        return (
          <TourExplanation
            key={tourPoint.appRefName}
            active={currentTourIndex === index}
            currentStep={currentTourIndex + 1}
            maxSteps={maxSteps}
            setTourIndex={idx => viewState.setTourIndex(idx)}
            onTourIndicatorClick={() => viewState.setTourIndex(index)}
            onPrevious={() => viewState.previousTourPoint()}
            onNext={() => viewState.nextTourPoint()}
            onSkip={() => viewState.closeTour()}
            isFirstTourPoint={index === 0}
            isLastTourPoint={index === tourPoints.length - 1}
            topStyle={`${positionTop}px`}
            leftStyle={`${positionLeft}px`}
            caretOffsetTop={caretOffsetTop}
            caretOffsetLeft={caretOffsetLeft}
            indicatorOffsetTop={indicatorOffsetTop}
            indicatorOffsetLeft={indicatorOffsetLeft}
          >
            {parseCustomMarkdownToReact(tourPoint?.content)}
          </TourExplanation>
        );
      })}
    </>
  );
});

export const TourPreface = ({ viewState }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <>
      <TourPrefaceBox
        onClick={() => viewState.closeTour()}
        role="presentation"
        aria-hidden="true"
        pseudoBg
      />
      <TourExplanationBox
        longer
        paddedRatio={4}
        column
        style={{
          right: 25,
          bottom: 45
        }}
      >
        <CloseButton
          color={theme.darkWithOverlay}
          // color={"green"}
          topRight
          onClick={() => viewState.closeTour()}
        />
        <Spacing bottom={2} />
        <Text extraExtraLarge bold textDarker>
          {t("tour.preface.title")}
        </Text>
        <Spacing bottom={3} />
        <Text light medium textDarker>
          {t("tour.preface.content")}
        </Text>
        <Spacing bottom={4} />
        <Text medium>
          <Box>
            <Button
              fullWidth
              secondary
              onClick={e => {
                e.stopPropagation();
                viewState.closeTour();
              }}
            >
              {t("tour.preface.close")}
            </Button>
            <Spacing right={3} />
            <Button
              primary
              fullWidth
              textProps={{ noFontSize: true }}
              onClick={e => {
                e.stopPropagation();
                viewState.setShowTour(true);
              }}
            >
              {t("tour.preface.start")}
            </Button>
          </Box>
        </Text>
        <Spacing bottom={1} />
      </TourExplanationBox>
    </>
  );
};
TourPreface.propTypes = {
  viewState: PropTypes.object.isRequired
};

export const TourPortalDisplayName = "TourPortal";
export const TourPortal = observer(({ viewState }) => {
  const showPortal = viewState.currentTourIndex !== -1;
  const showPreface = showPortal && !viewState.showTour;
  useEffect(() =>
    autorun(() => {
      if (showPortal && viewState.topElement !== TourPortalDisplayName) {
        viewState.setTopElement(TourPortalDisplayName);
      }
    })
  );
  if (viewState.useSmallScreenInterface || !showPortal) {
    return null;
  }
  if (showPreface) {
    return <TourPreface viewState={viewState} />;
  }

  return (
    <TourGrouping
      viewState={viewState}
      tourPoints={viewState.tourPointsWithValidRefs}
    />
  );
});

TourPortal.propTypes = {
  children: PropTypes.node.isRequired,
  viewState: PropTypes.object.isRequired
};

export default withTheme(TourPortal);
