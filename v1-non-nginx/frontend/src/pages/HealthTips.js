import React from 'react';
import { Container, Row, Col, Card, ListGroup, Alert } from 'react-bootstrap';

const HealthTips = () => {
  // Tips data organized by categories
  const healthTips = {
    dailyHabits: [
      { tip: "Drink plenty of water (at least 8 glasses per day)", icon: "🚰" },
      { tip: "Maintain a healthy weight through regular exercise", icon: "⚖️" },
      { tip: "Get adequate sleep (7-9 hours per night)", icon: "😴" },
      { tip: "Practice stress management techniques", icon: "🧘" },
      { tip: "Monitor your blood pressure regularly", icon: "🩺" }
    ],
    diet: [
      { tip: "Reduce salt intake to less than 2,300mg per day", icon: "🧂" },
      { tip: "Eat plenty of fruits and vegetables", icon: "🥗" },
      { tip: "Limit animal protein consumption", icon: "🥩" },
      { tip: "Choose whole grains over refined grains", icon: "🌾" },
      { tip: "Avoid processed foods high in sodium", icon: "🚫" }
    ],
    warningSignals: [
      { tip: "Changes in urination frequency or color", icon: "⚠️" },
      { tip: "Swelling in feet, ankles, or hands", icon: "🦶" },
      { tip: "Persistent fatigue or weakness", icon: "😫" },
      { tip: "Lower back pain", icon: "🤕" },
      { tip: "High blood pressure", icon: "📈" }
    ]
  };

  return (
    <Container className="py-4">
      {/* Header Section */}
      <Row className="mb-4">
        <Col>
          <h1 className="display-5 fw-bold" style={{ color: '#F97316' }}>
            <i className="fas fa-heartbeat me-2"></i>
            Kidney Health Tips
          </h1>
          <p className="lead text-muted">
            Maintain your kidney health with these essential tips and guidelines.
          </p>
        </Col>
      </Row>

      {/* Important Notice */}
      <Alert variant="info" className="mb-4">
        <i className="fas fa-info-circle me-2"></i>
        <strong>Important:</strong> These tips are for general guidance only. Always consult with your healthcare provider for personalized medical advice.
      </Alert>

      {/* Daily Habits Section */}
      <Row className="mb-4">
        <Col lg={4} className="mb-4">
          <Card className="h-100 border-0 shadow-sm">
            <Card.Header className="bg-primary text-white" style={{ backgroundColor: '#F97316 !important' }}>
              <h4 className="mb-0">
                <i className="fas fa-calendar-check me-2"></i>
                Daily Habits
              </h4>
            </Card.Header>
            <Card.Body>
              <ListGroup variant="flush">
                {healthTips.dailyHabits.map((item, index) => (
                  <ListGroup.Item key={index} className="border-0 py-3">
                    <span className="me-2" role="img" aria-label="icon">
                      {item.icon}
                    </span>
                    {item.tip}
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </Card.Body>
          </Card>
        </Col>

        {/* Diet Recommendations */}
        <Col lg={4} className="mb-4">
          <Card className="h-100 border-0 shadow-sm">
            <Card.Header className="bg-success text-white">
              <h4 className="mb-0">
                <i className="fas fa-utensils me-2"></i>
                Diet Tips
              </h4>
            </Card.Header>
            <Card.Body>
              <ListGroup variant="flush">
                {healthTips.diet.map((item, index) => (
                  <ListGroup.Item key={index} className="border-0 py-3">
                    <span className="me-2" role="img" aria-label="icon">
                      {item.icon}
                    </span>
                    {item.tip}
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </Card.Body>
          </Card>
        </Col>

        {/* Warning Signs */}
        <Col lg={4} className="mb-4">
          <Card className="h-100 border-0 shadow-sm">
            <Card.Header className="bg-danger text-white">
              <h4 className="mb-0">
                <i className="fas fa-exclamation-triangle me-2"></i>
                Warning Signs
              </h4>
            </Card.Header>
            <Card.Body>
              <ListGroup variant="flush">
                {healthTips.warningSignals.map((item, index) => (
                  <ListGroup.Item key={index} className="border-0 py-3">
                    <span className="me-2" role="img" aria-label="icon">
                      {item.icon}
                    </span>
                    {item.tip}
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Additional Information */}
      <Row>
        <Col>
          <Card className="border-0 shadow-sm">
            <Card.Body>
              <h4 className="mb-3" style={{ color: '#F97316' }}>
                <i className="fas fa-book-medical me-2"></i>
                Additional Resources
              </h4>
              <Row>
                <Col md={6}>
                  <h5>Prevention Tips</h5>
                  <ul className="list-unstyled">
                    <li className="mb-2">
                      <i className="fas fa-check text-success me-2"></i>
                      Regular exercise (at least 30 minutes daily)
                    </li>
                    <li className="mb-2">
                      <i className="fas fa-check text-success me-2"></i>
                      Maintain healthy blood sugar levels
                    </li>
                    <li className="mb-2">
                      <i className="fas fa-check text-success me-2"></i>
                      Regular health check-ups
                    </li>
                    <li className="mb-2">
                      <i className="fas fa-check text-success me-2"></i>
                      Quit smoking and limit alcohol
                    </li>
                  </ul>
                </Col>
                <Col md={6}>
                  <h5>Risk Factors</h5>
                  <ul className="list-unstyled">
                    <li className="mb-2">
                      <i className="fas fa-exclamation-circle text-danger me-2"></i>
                      Diabetes
                    </li>
                    <li className="mb-2">
                      <i className="fas fa-exclamation-circle text-danger me-2"></i>
                      High blood pressure
                    </li>
                    <li className="mb-2">
                      <i className="fas fa-exclamation-circle text-danger me-2"></i>
                      Family history of kidney disease
                    </li>
                    <li className="mb-2">
                      <i className="fas fa-exclamation-circle text-danger me-2"></i>
                      Obesity
                    </li>
                  </ul>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default HealthTips; 